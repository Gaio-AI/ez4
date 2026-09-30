import type { Client, Content, ObjectEntry, SignReadOptions, SignWriteOptions, WriteOptions } from '@ez4/storage';
import type { ObjectAttributes } from '../utils/attributes';

import { Readable } from 'node:stream';

import mime from 'mime';

import { toKebabCase } from '@ez4/utils';
import { Logger } from '@ez4/logger';

import { getObjectMetadata } from '../utils/attributes';
import { ObjectNotFoundError } from '../utils/errors';

export type ClientMockOptions = {
  keys?: Record<string, Buffer>;
  default?: Buffer;
};

export const createClientMock = (serviceName: string, options?: ClientMockOptions): Client => {
  const storageIdentifier = toKebabCase(serviceName);
  const storageMemory = options?.keys ?? {};

  const attributesMemory: Record<string, ObjectAttributes> = {};

  return new (class {
    async stat(key: string) {
      const content = storageMemory[key] ?? options?.default;

      if (!content) {
        return undefined;
      }

      const attributes = attributesMemory[key];

      return Promise.resolve({
        type: attributes?.contentType ?? 'binary/octet-stream',
        metadata: attributes?.metadata ?? {},
        size: content.byteLength
      });
    }

    async exists(key: string) {
      const content = storageMemory[key] ?? options?.default;

      return Promise.resolve(!!content);
    }

    async write(key: string, contents: Content, writeOptions: WriteOptions = {}) {
      const { contentType = mime.getType(key), metadata } = writeOptions;

      Logger.log(`⬆️  File ${key} uploaded.`);

      storageMemory[key] = await getContentBuffer(contents);

      attributesMemory[key] = {
        ...(contentType && { contentType }),
        ...(metadata && { metadata: getObjectMetadata(metadata) })
      };
    }

    async read(key: string): Promise<Buffer> {
      const content = storageMemory[key] ?? options?.default;

      if (!content) {
        throw new ObjectNotFoundError();
      }

      Logger.log(`⬇️  File ${key} downloaded.`);

      return Promise.resolve(Buffer.from(content));
    }

    async delete(key: string) {
      if (storageMemory[key]) {
        Logger.log(`ℹ️  File ${key} deleted.`);

        delete storageMemory[key];
      }

      delete attributesMemory[key];

      return Promise.resolve();
    }

    async copy(sourceKey: string, targetKey: string) {
      const content = storageMemory[sourceKey] ?? options?.default;

      if (!content) {
        throw new ObjectNotFoundError();
      }

      Logger.log(`ℹ️  File ${sourceKey} copied.`);

      storageMemory[targetKey] = content;
      attributesMemory[targetKey] = attributesMemory[sourceKey];

      return Promise.resolve();
    }

    async *scan(keyPrefix?: string): AsyncGenerator<ObjectEntry, void> {
      for (const key in storageMemory) {
        if (keyPrefix && !key.startsWith(keyPrefix)) {
          continue;
        }

        const content = storageMemory[key];

        yield Promise.resolve({
          modifiedAt: new Date(),
          size: content.length,
          key
        });
      }
    }

    async getStatUrl(key: string, _options: SignReadOptions) {
      return Promise.resolve(`http://${storageIdentifier}/${key}`);
    }

    async getWriteUrl(key: string, _options: SignWriteOptions) {
      return Promise.resolve(`http://${storageIdentifier}/${key}`);
    }

    async getReadUrl(key: string, _options: SignReadOptions) {
      return Promise.resolve(`http://${storageIdentifier}/${key}`);
    }
  })();
};

const getContentBuffer = async (contents: Content) => {
  if (!(contents instanceof Readable)) {
    return Buffer.from(contents);
  }

  const chunks: Buffer[] = [];

  for await (const chunk of contents) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};
