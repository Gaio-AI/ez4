import type { LoadHookSync, ResolveHookContext, ResolveHookSync } from 'node:module';

import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import { tryLoadProject } from '../config/project';
import { tryLoadReferences } from '../config/references';
import { tryLoadPaths } from '../config/tsconfig';

const options = await tryLoadProject(process.env.EZ4_PROJECT_FILE, undefined, true);
const references = await tryLoadReferences(options);
const paths = await tryLoadPaths(options);

const aliasPaths = {
  ...references.paths,
  ...paths
};

// A handler loaded for a serve reload carries `?v=<version>`, and every project module it reaches carries the same
// one: a reload loads each module once more, and within a version a module is a single instance, so `instanceof`
// and import cycles behave as in the bundle.
const resolve: ResolveHookSync = (specifier, context, defaultResolve) => {
  if (isGlobalParentModule(context)) {
    return defaultResolve(specifier, context);
  }

  const parentFile = context.parentURL ? fileURLToPath(context.parentURL) : '.';
  const modulePath = resolveImportPath(specifier, parentFile, aliasPaths);
  const version = getParentVersion(context);

  if (modulePath) {
    return defaultResolve(version ? getVersionedPath(modulePath, version) : modulePath, context);
  }

  const result = defaultResolve(specifier, context);

  if (!version || !isProjectModule(specifier, result.url, version)) {
    return result;
  }

  return {
    ...result,
    url: getVersionedPath(result.url, version)
  };
};

const isGlobalParentModule = ({ parentURL }: ResolveHookContext) => {
  return parentURL?.includes('/node_modules/');
};

const getParentVersion = ({ parentURL }: ResolveHookContext) => {
  return parentURL ? new URL(parentURL).searchParams.get('v') : null;
};

const getVersionedPath = (modulePath: string, version: string) => {
  return `${modulePath}?v=${version}`;
};

/**
 * Whether a module that the default resolution found is project code, which a reload has to load again. A
 * relative import is, and so is a package outside `node_modules` whose entry is TypeScript source (a workspace
 * package linked into `node_modules`). A built package outside `node_modules` keeps one instance across reloads,
 * as every package inside it does, so the state it holds for the emulators is the one the handler sees.
 *
 * Tests stay on version 0, which nothing reloads: there a workspace package keeps the single instance a spec
 * imports, so a spec that mocks one of its exports reaches the handler a tester runs.
 */
const isProjectModule = (specifier: string, url: string, version: string) => {
  if (!url.startsWith('file:') || url.includes('/node_modules/')) {
    return false;
  }

  if (specifier.startsWith('.')) {
    return true;
  }

  return version !== '0' && /\.[cm]?tsx?$/.test(new URL(url).pathname);
};

const resolveImportPath = (specifier: string, parentFile: string, aliasPaths: Record<string, string[]>) => {
  for (const prefix in aliasPaths) {
    const prefixPattern = prefix.substring(0, prefix.length - 1);

    if (!specifier.startsWith(prefixPattern)) {
      continue;
    }

    for (const globPath of aliasPaths[prefix]) {
      const mergedPath = globPath.substring(0, globPath.length - 1) + specifier.substring(prefix.length - 1);
      const modulePath = resolveModulePath(mergedPath, process.cwd());

      if (modulePath) {
        return modulePath;
      }
    }
  }

  return resolveModulePath(specifier, dirname(parentFile));
};

const resolveModulePath = (specifier: string, parentPath: string) => {
  if (specifier.startsWith('file://')) {
    return undefined;
  }

  if (specifier.startsWith('.') && !extname(specifier)) {
    return resolveSpecifier(specifier, parentPath, 'js') ?? resolveSpecifier(specifier, parentPath, 'ts');
  }

  if (specifier.endsWith('.js')) {
    return resolveSpecifier(specifier.slice(0, -3), parentPath, 'ts');
  }

  return undefined;
};

const resolveSpecifier = (specifier: string, parentPath: string, extension: string) => {
  const filePath = `${specifier}.${extension}`;
  const fullPath = join(parentPath, filePath);

  if (existsSync(fullPath)) {
    return fullPath;
  }

  return undefined;
};

// A package bundles its `.pem` files as text (esbuild's `text` loader), so its source loads them the same way.
const load: LoadHookSync = (url, context, defaultLoad) => {
  if (!url.startsWith('file:') || !new URL(url).pathname.endsWith('.pem')) {
    return defaultLoad(url, context);
  }

  const text = readFileSync(fileURLToPath(url), 'utf8');

  return {
    format: 'module',
    source: `export default ${JSON.stringify(text)};`,
    shortCircuit: true
  };
};

// The hooks run on the thread that loads the modules, so resolving costs no hop to a loader thread.
registerHooks({ resolve, load });
