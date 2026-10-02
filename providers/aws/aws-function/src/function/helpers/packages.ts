import type { BundledPackage } from '@ez4/aws-common';

import { getBundledPackages, getInstalledPackages, getPackagesHash } from '@ez4/aws-common';

/**
 * The packages hash of a deployed function as installed now, read at the roots its bundle recorded.
 * A function deployed before the packages were recorded has nothing to read, and the hash it gets
 * can't match the one it never stored: it's rebundled once, and uploaded only if the bundle differs.
 */
export const getInstalledPackagesHash = async (bundledPackages: BundledPackage[] | undefined) => {
  return getPackagesHash(bundledPackages ? await getInstalledPackages(bundledPackages) : []);
};

/**
 * What a function records about the packages of a bundle just built. A bundle from somewhere other
 * than the shared bundler records none, and only its files decide when it changes.
 */
export const getPackagesResult = (bundleFile: string) => {
  const bundledPackages = getBundledPackages(bundleFile) ?? [];

  return {
    packagesHash: getPackagesHash(bundledPackages),
    bundledPackages
  };
};
