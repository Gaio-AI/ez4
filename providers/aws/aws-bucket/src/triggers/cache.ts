import type { BucketCacheRule } from '@ez4/storage/library';

export const getObjectCacheControl = (rules: BucketCacheRule[] | undefined, objectKey: string) => {
  return rules?.find(({ path }) => isCachePathMatch(path, objectKey))?.value;
};

const isCachePathMatch = (path: string, objectKey: string) => {
  if (path === '*') {
    return true;
  }

  if (path.endsWith('/*')) {
    return objectKey.startsWith(path.slice(0, -1));
  }

  return path === objectKey;
};
