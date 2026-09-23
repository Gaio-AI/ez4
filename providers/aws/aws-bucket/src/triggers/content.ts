import type { BucketService } from '@ez4/storage/library';
import type { BucketState } from '@ez4/aws-bucket';
import type { EntryStates } from '@ez4/state';

import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { createBucketObject } from '@ez4/aws-bucket';

import { getObjectCacheControl } from './cache';

export type LocalContentOptions = Pick<BucketService, 'staleExpireDays' | 'cacheControl'>;

export const prepareLocalContent = async (
  state: EntryStates,
  bucketState: BucketState,
  localPath: string,
  options: LocalContentOptions
) => {
  const { staleExpireDays, cacheControl } = options;

  const basePath = process.cwd();
  const fullPath = join(basePath, localPath);

  const allFiles = await readdir(fullPath, {
    withFileTypes: true,
    recursive: true
  });

  for (const file of allFiles) {
    if (!file.isFile()) {
      continue;
    }

    const filePath = join(file.parentPath, file.name);
    const objectKey = relative(fullPath, filePath);

    createBucketObject(state, bucketState, {
      cacheControl: getObjectCacheControl(cacheControl, objectKey),
      filePath: relative(basePath, filePath),
      staleExpireDays,
      objectKey
    });
  }
};
