import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * A package a bundle carries from `node_modules`: where its root sits, relative to the project like
 * every path the deploy hashes, and the version installed there when the bundle was built.
 */
export type BundledPackage = {
  path: string;
  version: string;
};

const versionCache = new Map<string, Promise<string | undefined>>();

const readPackageVersion = async (manifestFile: string) => {
  try {
    const { version } = JSON.parse(await readFile(manifestFile, 'utf8'));

    return typeof version === 'string' ? version : '';
  } catch {
    return undefined;
  }
};

/**
 * The version installed at a package root, read once per process: a deploy never sees a package
 * change under it, and every function bundling the same package asks for it again.
 */
const getPackageVersion = (packagePath: string) => {
  const manifestFile = resolve(packagePath, 'package.json');

  let version = versionCache.get(manifestFile);

  if (!version) {
    version = readPackageVersion(manifestFile);

    versionCache.set(manifestFile, version);
  }

  return version;
};

/**
 * The root of the installed package a file belongs to: the folder right under the last
 * `node_modules` of its path, or the two folders of a scoped name. That holds for nested installs and
 * for pnpm's store, where the package sits in `.pnpm/<id>/node_modules`. A file outside any
 * `node_modules`, or lying right in one, belongs to no installed package.
 */
const getPackageRoot = (filePath: string) => {
  const segments = filePath.split(/[\\/]/);
  const index = segments.lastIndexOf('node_modules');

  if (index < 0) {
    return undefined;
  }

  const nameLength = segments[index + 1]?.startsWith('@') ? 2 : 1;
  const rootLength = index + 1 + nameLength;

  if (rootLength >= segments.length) {
    return undefined;
  }

  return segments.slice(0, rootLength).join('/');
};

const readInstalledPackages = async (packagePaths: string[]) => {
  const packages = await Promise.all(
    packagePaths.map(async (path) => {
      return {
        path,
        version: await getPackageVersion(path)
      };
    })
  );

  return packages.filter((current): current is BundledPackage => current.version !== undefined);
};

/**
 * The installed packages behind the files esbuild reports as inputs of a bundle, given relative to
 * the project. A root without a readable `package.json` has no version to follow and is left out.
 */
export const collectBundledPackages = async (inputFiles: string[]) => {
  const packagePaths = new Set<string>();

  for (const inputFile of inputFiles) {
    const packagePath = getPackageRoot(inputFile);

    if (packagePath) {
      packagePaths.add(packagePath);
    }
  }

  const packages = await readInstalledPackages([...packagePaths]);

  return packages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
};

/**
 * What is installed now at the roots of the given packages, in the same order. A package whose root
 * no longer has a `package.json` is left out.
 */
export const getInstalledPackages = (packages: BundledPackage[]) => {
  return readInstalledPackages(packages.map(({ path }) => path));
};

/**
 * Hash of the packages by path and version, in the order given. A recorded list and what is installed
 * at its roots now come out in the same order, so the two hashes differ exactly when a version
 * changed or a package is gone.
 */
export const getPackagesHash = (packages: BundledPackage[]) => {
  const entries = packages.map(({ path, version }) => [path, version]);

  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
};
