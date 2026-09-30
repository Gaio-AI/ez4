import type { ServeOptions } from '@ez4/project/library';
import type { Bucket, Client, Content, ObjectEntry, SignReadOptions, SignWriteOptions, WriteOptions } from '@ez4/storage';

import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import mime from 'mime';

import { getServiceName } from '@ez4/project/library';
import { BucketEventType } from '@ez4/storage';
import { Logger } from '@ez4/logger';

import {
  deleteObjectAttributes,
  getObjectMetadata,
  getStorageDirectory,
  isMissingFileError,
  readObjectAttributes,
  writeObjectAttributes
} from '../utils/attributes';

import { ObjectNotFoundError } from '../utils/errors';

type EventHandler = (event: Bucket.ObjectEvent) => Promise<void>;

export type LocalClientOptions = ServeOptions & {
  events?: {
    handler: EventHandler;
    prefix: string;
    suffix: string;
  }[];
};

// What S3 reports for an object stored without a content type.
const DEFAULT_CONTENT_TYPE = 'binary/octet-stream';

// S3 invokes the event handler asynchronously, and AWS retries a failed asynchronous invocation twice.
const EVENT_RETRY_DELAYS = [1000, 2000];

export const createLocalClient = (resourceName: string, options: LocalClientOptions): Client => {
  const storageIdentifier = getServiceName(resourceName, options);
  const storageDirectory = getStorageDirectory(resourceName);
  const storageEvents = options.events;

  const getObjectPath = (key: string) => {
    return join(storageDirectory, key);
  };

  const getObjectStats = async (key: string) => {
    try {
      const stats = await stat(getObjectPath(key));

      return stats.isFile() ? stats : undefined;
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      return undefined;
    }
  };

  const sendObjectEvent = (event: Bucket.ObjectEvent) => {
    storageEvents?.forEach(({ prefix, suffix, handler }) => {
      if (event.objectKey.startsWith(prefix) && event.objectKey.endsWith(suffix)) {
        invokeEventHandler(handler, event);
      }
    });
  };

  return new (class {
    async stat(key: string) {
      const stats = await getObjectStats(key);

      if (!stats) {
        return undefined;
      }

      const attributes = await readObjectAttributes(resourceName, key);

      return {
        type: attributes?.contentType ?? DEFAULT_CONTENT_TYPE,
        metadata: attributes?.metadata ?? {},
        size: stats.size
      };
    }

    async exists(key: string) {
      const stats = await getObjectStats(key);

      return !!stats;
    }

    async write(key: string, contents: Content, writeOptions: WriteOptions = {}) {
      const { contentType = mime.getType(key), metadata, headers } = writeOptions;

      const filePath = getObjectPath(key);

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);

      await writeObjectAttributes(resourceName, key, {
        ...(contentType && { contentType }),
        ...(metadata && { metadata: getObjectMetadata(metadata) }),
        ...(headers?.cacheControl && { cacheControl: headers.cacheControl }),
        ...(headers?.expires && { expires: headers.expires.toISOString() })
      });

      Logger.log(`⬆️  File ${key} uploaded.`);

      const { size } = await stat(filePath);

      sendObjectEvent({
        eventType: BucketEventType.Create,
        bucketName: storageIdentifier,
        objectSize: size,
        objectKey: key
      });
    }

    async read(key: string): Promise<Buffer> {
      try {
        const fileContent = await readFile(getObjectPath(key));

        Logger.log(`⬇️  File ${key} downloaded.`);

        return fileContent;
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }

        throw new ObjectNotFoundError();
      }
    }

    async delete(key: string) {
      const stats = await getObjectStats(key);

      await deleteObjectAttributes(resourceName, key);

      if (!stats) {
        return;
      }

      await unlink(getObjectPath(key));

      Logger.log(`ℹ️  File ${key} deleted.`);

      sendObjectEvent({
        eventType: BucketEventType.Delete,
        bucketName: storageIdentifier,
        objectKey: key
      });
    }

    async copy(sourceKey: string, targetKey: string) {
      // The AWS client skips a copy onto the same key.
      if (sourceKey === targetKey) {
        return;
      }

      if (!(await getObjectStats(sourceKey))) {
        throw new ObjectNotFoundError();
      }

      const targetPath = getObjectPath(targetKey);

      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(getObjectPath(sourceKey), targetPath);

      // S3 copies the object metadata along with the object.
      const attributes = await readObjectAttributes(resourceName, sourceKey);

      if (attributes) {
        await writeObjectAttributes(resourceName, targetKey, attributes);
      } else {
        await deleteObjectAttributes(resourceName, targetKey);
      }

      Logger.log(`ℹ️  File ${sourceKey} copied.`);

      const { size } = await stat(targetPath);

      sendObjectEvent({
        eventType: BucketEventType.Create,
        bucketName: storageIdentifier,
        objectSize: size,
        objectKey: targetKey
      });
    }

    async *scan(keyPrefix = ''): AsyncGenerator<ObjectEntry, void> {
      const allKeys = await getObjectKeys(storageDirectory);

      const objectKeys = allKeys.filter((key) => key.startsWith(keyPrefix)).sort();

      for (const key of objectKeys) {
        const stats = await getObjectStats(key);

        if (stats) {
          yield {
            key,
            modifiedAt: stats.mtime,
            size: stats.size
          };
        }
      }
    }

    async getStatUrl(key: string, _options: SignReadOptions) {
      return Promise.resolve(`http://${options.serviceHost}/${storageIdentifier}/${key}`);
    }

    async getWriteUrl(key: string, _options: SignWriteOptions) {
      return Promise.resolve(`http://${options.serviceHost}/${storageIdentifier}/${key}`);
    }

    async getReadUrl(key: string, _options: SignReadOptions) {
      return Promise.resolve(`http://${options.serviceHost}/${storageIdentifier}/${key}`);
    }
  })();
};

const getObjectKeys = async (storageDirectory: string) => {
  try {
    const allEntries = await readdir(storageDirectory, {
      withFileTypes: true,
      recursive: true
    });

    return allEntries
      .filter((entry) => entry.isFile())
      .map((entry) => {
        return relative(storageDirectory, join(entry.parentPath, entry.name)).split(sep).join('/');
      });
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    return [];
  }
};

const invokeEventHandler = async (handler: EventHandler, event: Bucket.ObjectEvent, attempt = 0) => {
  try {
    await handler(event);
    //
  } catch {
    const { bucketName, eventType, objectKey } = event;

    const delay = EVENT_RETRY_DELAYS[attempt];
    const label = `Bucket [${bucketName}] ${eventType} event for ${objectKey}`;

    if (delay === undefined) {
      return Logger.error(`${label} failed after ${attempt + 1} attempts and was dropped.`);
    }

    Logger.warn(`${label} failed, retry ${attempt + 1} of ${EVENT_RETRY_DELAYS.length} in ${delay / 1000}s.`);

    setTimeout(() => invokeEventHandler(handler, event, attempt + 1), delay);
  }
};
