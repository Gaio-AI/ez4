import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isAnyObject, toKebabCase } from '@ez4/utils';

export type ObjectAttributes = {
  contentType?: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
  expires?: string;
};

export const getStorageDirectory = (resourceName: string) => {
  return join('.ez4', toKebabCase(resourceName));
};

// The attributes live next to the bucket directory, so they never show up as objects.
const getAttributesPath = (resourceName: string, key: string) => {
  return join(`${getStorageDirectory(resourceName)}.attributes`, `${key}.json`);
};

export const isMissingFileError = (error: unknown) => {
  return isAnyObject(error) && ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code);
};

// S3 stores the metadata names in lowercase.
export const getObjectMetadata = (metadata: Record<string, string>) => {
  return Object.fromEntries(Object.entries(metadata).map(([name, value]) => [name.toLowerCase(), value]));
};

export const readObjectAttributes = async (resourceName: string, key: string): Promise<ObjectAttributes | undefined> => {
  try {
    const content = await readFile(getAttributesPath(resourceName, key));

    return JSON.parse(content.toString());
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    return undefined;
  }
};

export const writeObjectAttributes = async (resourceName: string, key: string, attributes: ObjectAttributes) => {
  const filePath = getAttributesPath(resourceName, key);

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(attributes));
};

export const deleteObjectAttributes = async (resourceName: string, key: string) => {
  try {
    await rm(getAttributesPath(resourceName, key), { force: true });
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
};
