import type { LinkedContext } from '@ez4/project/library';
import type { AnyObject } from '@ez4/utils';
import type { BundledPackage } from './packages';

import { build, formatMessages } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, parse, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';

import { arrayUnique, hashObject, isNullish, toKebabCase, toSnakeCase } from '@ez4/utils';
import { getTemporaryPath } from '@ez4/project/library';
import { Logger } from '@ez4/logger';

import { SourceFileError } from '../errors/bundler';
import { collectBundledPackages } from './packages';

const fileCache = new Map<string, string>();
const hashCache = new Map<string, string>();
const pathCache = new Map<string, string>();

const packagesCache = new Map<string, BundledPackage[]>();

export type BundlerEntrypoint = {
  functionName: string;
  sourceFile: string;
  module?: string;
};

export type BundlerOptions = {
  filePrefix: string;
  templateFile: string;
  resourceName: string;
  handler: BundlerEntrypoint;
  listener?: BundlerEntrypoint;
  context?: Record<string, LinkedContext>;
  define?: Record<string, string>;
  debug?: boolean;
  target?: string;
};

/**
 * A bundle of several handlers, which its template reads from `__EZ4_HANDLERS` in the given order.
 */
export type BundlerGroupOptions = Omit<BundlerOptions, 'handler'> & {
  /**
   * Name the bundle is cached and written under, unique among the bundles of a deploy.
   */
  groupName: string;
  handlers: BundlerEntrypoint[];
};

const isGroupOptions = (options: BundlerOptions | BundlerGroupOptions): options is BundlerGroupOptions => {
  return 'handlers' in options;
};

/**
 * A file's contribution to the bundle hash: where it sits in the project, and what it holds.
 *
 * Both halves are deliberate. The path is relative so the same tree hashes the same from any
 * checkout — an absolute one makes every function look changed when the deploy runs from another
 * directory or another machine. The digest is of the content rather than the mtime, which a rebuild
 * bumps without changing a byte, and which a copy that preserves timestamps leaves untouched over
 * content that did change.
 */
const getFileSignature = async (filePath: string) => {
  const cached = pathCache.get(filePath);

  if (cached) {
    return cached;
  }

  const content = await readFile(filePath);
  const digest = createHash('sha256').update(content).digest('hex');

  const signature = `${relative(process.cwd(), filePath)}:${digest}`;

  pathCache.set(filePath, signature);

  return signature;
};

export const createBundleHash = async (allSourceFiles: string[]) => {
  const fileSignatures = createHash('sha256');

  const pathSignatures = await Promise.all(
    allSourceFiles.map(async (filePath) => {
      return {
        filePath,
        pathSignature: await getFileSignature(filePath)
      };
    })
  );

  // Ensure the same position to not trigger updates without real changes. Ordering by the signature
  // rather than by the absolute path keeps the order stable across checkouts too.
  pathSignatures.sort((a, b) => a.pathSignature.localeCompare(b.pathSignature));

  for (const { pathSignature } of pathSignatures) {
    fileSignatures.update(pathSignature);
  }

  return fileSignatures.digest('hex');
};

export const getBundleHash = async (sourceFile: string, dependencyFiles: string[]) => {
  // Functions built from the same source can still bundle different files, such as their runtime
  // template, so the cache answers for the whole list rather than for the source alone.
  const cacheKey = [sourceFile, ...dependencyFiles].join('\n');

  let bundleHash = hashCache.get(cacheKey);

  if (!bundleHash) {
    bundleHash = await createBundleHash(arrayUnique(dependencyFiles));

    hashCache.set(cacheKey, bundleHash);
  }

  return bundleHash;
};

const maxTokens = Math.max(1, Math.floor(cpus().length / 2));

const scheduleQueue: {
  provider: string;
  options: BundlerOptions | BundlerGroupOptions;
  resolve: (outputFile: string) => void;
  reject: (reason?: any) => void;
}[] = [];

let activeTokens = 0;

export const getFunctionBundle = async (provider: string, options: BundlerOptions | BundlerGroupOptions) => {
  if (activeTokens < maxTokens) {
    try {
      activeTokens++;
      return await buildFunctionBundle(provider, options);
    } finally {
      activeTokens--;

      const next = scheduleQueue.shift();

      if (next) {
        const { provider, options, resolve, reject } = next;

        getFunctionBundle(provider, options).then(resolve).catch(reject);
      }
    }
  }

  return new Promise<string>((resolve, reject) => {
    scheduleQueue.push({
      provider,
      options,
      resolve,
      reject
    });
  });
};

/**
 * The installed packages a bundle built in this process carries, from `node_modules`. The source
 * hash follows only their declarations, so the deploy records them with the function to notice
 * when an installed version changes under it. Undefined for a file the bundler didn't build.
 */
export const getBundledPackages = (bundleFile: string) => {
  return packagesCache.get(bundleFile);
};

export const buildFunctionBundle = async (provider: string, options: BundlerOptions | BundlerGroupOptions) => {
  const { cacheKey, sourceName, targetFile } = getBundleTarget(options);

  const cacheFile = fileCache.get(cacheKey);

  if (cacheFile && existsSync(cacheFile)) {
    return cacheFile;
  }

  const { resourceName, target, debug } = options;

  const outputFile = getTemporaryPath(targetFile);

  const result = await build({
    // esbuild otherwise works from the folder the process was in when esbuild loaded, and reports
    // its inputs relative to it; the project is the current folder, as for every hashed path.
    absWorkingDir: process.cwd(),
    outfile: outputFile,
    metafile: true,
    treeShaking: !debug,
    minifyWhitespace: true,
    minifySyntax: true,
    platform: 'node',
    packages: 'bundle',
    format: 'esm',
    external: ['@aws-sdk/*'],
    keepNames: true,
    bundle: true,
    target,
    define: {
      ...options.define,
      EZ4_RESOURCE_NAME: `'${resourceName}'`,
      EZ4_IS_DEBUG_RUNTIME: `${!!debug}`,
      EZ4_IS_REMOTE_RUNTIME: 'true'
    },
    stdin: {
      resolveDir: process.cwd(),
      contents: await getEntrypointCode(options),
      sourcefile: 'main.ts',
      loader: 'ts'
    },
    banner: {
      js: getCompatibilityCode()
    }
  });

  const [errors, warnings] = await Promise.all([
    formatMessages(result.errors, {
      kind: 'error',
      color: false
    }),
    formatMessages(result.warnings, {
      kind: 'warning',
      color: false
    })
  ]);

  warnings.forEach((message) => {
    Logger.warn(`[${provider}]: ${message}`);
  });

  errors.forEach((message) => {
    Logger.error(`[${provider}]: ${message}`);
  });

  if (errors.length) {
    throw new SourceFileError(sourceName);
  }

  packagesCache.set(outputFile, await collectBundledPackages(Object.keys(result.metafile.inputs)));

  fileCache.set(cacheKey, outputFile);

  return outputFile;
};

const getBundleTarget = (options: BundlerOptions | BundlerGroupOptions) => {
  const { filePrefix } = options;

  // A source file always has an extension, so no handler key reads as a group one.
  if (isGroupOptions(options)) {
    const { groupName } = options;

    return {
      cacheKey: `group:${groupName}`,
      targetFile: `${filePrefix}.${toKebabCase(groupName)}.mjs`,
      sourceName: groupName
    };
  }

  const { sourceFile, functionName } = options.handler;
  const { dir: targetPath, name: targetName } = parse(sourceFile);

  const handlerName = toKebabCase(functionName);

  return {
    cacheKey: `${sourceFile}:${functionName}`,
    targetFile: join(targetPath, `${filePrefix}.${targetName}.${handlerName}.mjs`),
    sourceName: sourceFile
  };
};

const getCompatibilityCode = () => {
  return `
import { createRequire as __EZ4_CREATE_REQUIRE } from 'node:module';
import { fileURLToPath as __EZ4_FILE_URL_TO_PATH } from 'node:url';
import { dirname as __EZ4_DIRNAME } from 'node:path';

const require = __EZ4_CREATE_REQUIRE(import.meta.url);

const __filename = __EZ4_FILE_URL_TO_PATH(import.meta.url);
const __dirname = __EZ4_DIRNAME(__filename);
`;
};

const getEntrypointCode = async (options: BundlerOptions | BundlerGroupOptions) => {
  const template = await readFile(options.templateFile);
  const context = buildServiceContext(options.context ?? {});

  const { listener } = options;

  return `
${getHandlerCode(options)}
${listener ? `import { ${listener.functionName} as dispatch } from '${getEntrypointImport(listener)}'` : `const dispatch = () => {}`};
${context.packages.join('\n')}

const __EZ4_MAKE_LAZY_CONTEXT_FACTORY = (context)=> {
  return new Proxy(context, {
    get: (target, property) => {
      if (typeof property !== 'string' || !(property in target)) {
        throw new Error(\`Context service '\${property.toString()}' not found.\`);
      }

      if (target[property] instanceof Function) {
        target[property] = target[property]();
      }

      return target[property];
    }
  });
}

const __EZ4_REPOSITORY = ${context.repository};
const __EZ4_CONTEXT = ${context.services};

${template}
`;
};

const getHandlerCode = (options: BundlerOptions | BundlerGroupOptions) => {
  if (!isGroupOptions(options)) {
    const { handler } = options;

    return `import { ${handler.functionName} as handle } from '${getEntrypointImport(handler)}';`;
  }

  // Aliased by position, since handlers of different files may share a name.
  const imports = options.handlers.map((handler, index) => {
    return `import { ${handler.functionName} as __EZ4_HANDLER_${index} } from '${getEntrypointImport(handler)}';`;
  });

  const handlers = options.handlers.map((_, index) => `__EZ4_HANDLER_${index}`);

  return `${imports.join('\n')}\nconst __EZ4_HANDLERS = [${handlers.join(', ')}];`;
};

const getEntrypointImport = (entrypoint: BundlerEntrypoint) => {
  return entrypoint.module ?? `./${entrypoint.sourceFile}`;
};

const buildServiceContext = (linkedContext: Record<string, LinkedContext>) => {
  const repository: Record<string, string> = {};
  const resolutionCache = new Set<string>();
  const packages: string[] = [];

  const buildContext = (linkedContext: Record<string, LinkedContext>) => {
    const services: string[] = [];

    for (const serviceName of Object.keys(linkedContext).sort()) {
      const { constructor, module, from, options, context } = linkedContext[serviceName];

      const constructorHash = hashObject({ serviceName, options, module, from });
      const constructorName = `__EZ4_${toSnakeCase(constructorHash).toUpperCase()}`;

      services.push(`['${serviceName}']: __EZ4_REPOSITORY.${constructorName}`);

      if (!resolutionCache.has(constructorName)) {
        resolutionCache.add(constructorName);

        packages.push(`import { ${module} as ${constructorName} } from '${from}';`);

        repository[constructorName] = applyTemplateVariables(constructor, {
          EZ4_MODULE_OPTIONS: buildServiceOptions(options ?? {}),
          EZ4_MODULE_CONTEXT: context && buildContext(context),
          EZ4_MODULE_IMPORT: constructorName
        });
      }
    }

    return `__EZ4_MAKE_LAZY_CONTEXT_FACTORY({${services.join(',')}})`;
  };

  const services = buildContext(linkedContext);

  const factory = Object.entries(repository).map(([serviceName, service]) => {
    return `['${serviceName}']: () => ${service}`;
  });

  return {
    repository: `{${factory.join(',')}}`,
    packages,
    services
  };
};

const applyTemplateVariables = (constructor: string, variables: Record<string, string | undefined>) => {
  return constructor.replaceAll(/@\{([\w_]+)\}/g, (_, variableName) => {
    if (!(variableName in variables) || isNullish(variables[variableName])) {
      throw new Error(`Template variable '${variableName}' isn't expected.`);
    }

    return variables[variableName];
  });
};

const buildServiceOptions = (options: AnyObject) => {
  const result = [];

  for (const property in options) {
    if (property !== undefined) {
      result.push(`${property}: ${JSON.stringify(options[property])}`);
    } else {
      result.push(`${property}: undefined`);
    }
  }

  return `{${result.join(',')}}`;
};
