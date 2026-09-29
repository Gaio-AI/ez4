import type { EmulateServiceContext, EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { Client as StorageClient } from '@ez4/storage';
import type { BucketService } from '@ez4/storage/library';

import { getServiceName, triggerAllAsync } from '@ez4/project/library';
import { Logger } from '@ez4/logger';

import { processLambdaEvent } from '../handlers/lambda';
import { BucketManifest } from '../service/manifest';
import { readObjectAttributes } from '../utils/attributes';
import { createLocalClient } from '../client/local';

const METADATA_HEADER_PREFIX = 'x-amz-meta-';

export const registerLocalService = async (service: BucketService, options: ServeOptions, context: EmulateServiceContext) => {
  const client = await getStorageClient(service, options, context);

  const { name: resourceName } = service;

  return {
    type: 'Storage',
    name: resourceName,
    identifier: getServiceName(resourceName, options),
    bootstrapHandler: () => {
      Logger.log(`📂 ${options.local ? 'Local' : 'Remote'} storage [${resourceName}] in use.`);
    },
    requestHandler: (request: EmulatorRequestEvent) => {
      return handleRequest(resourceName, client, request);
    },
    exportHandler: () => {
      return client;
    },
    manifestHandler: () => {
      return BucketManifest.build(service);
    }
  };
};

const getStorageClient = async (service: BucketService, options: ServeOptions, context: EmulateServiceContext) => {
  const clientFactory = await triggerAllAsync('emulator:clientFactory', (handler) => handler({ service, options }));

  if (clientFactory) {
    return clientFactory.make() as StorageClient;
  }

  const { events } = service;

  return createLocalClient(service.name, {
    ...options,
    events: events?.map((event) => {
      const [prefix, suffix] = event.path.split('*', 2);

      return {
        prefix,
        suffix,
        handler: (input) => {
          return processLambdaEvent(service, options, context, event, input);
        }
      };
    })
  });
};

const handleRequest = async (resourceName: string, client: StorageClient, request: EmulatorRequestEvent) => {
  const { method, path, headers, body } = request;

  if (!path || path === '/') {
    throw new Error(`File path wasn't given.`);
  }

  const key = getObjectKey(path);

  switch (method) {
    case 'HEAD':
      return headFile(client, key);

    case 'GET':
      return loadFile(resourceName, client, key);

    case 'POST':
    case 'PUT': {
      if (!body) {
        throw new Error("File content wasn't given.");
      }

      return storeFile(client, key, body, headers);
    }

    default:
      throw new Error('Unsupported storage request.');
  }
};

// Signed URLs carry the object key in their path, which S3 decodes.
const getObjectKey = (path: string) => {
  const key = path.substring(1);

  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
};

const getRequestMetadata = (headers: Record<string, string>) => {
  const metadata: Record<string, string> = {};

  for (const name in headers) {
    if (name.startsWith(METADATA_HEADER_PREFIX)) {
      metadata[name.substring(METADATA_HEADER_PREFIX.length)] = headers[name];
    }
  }

  return metadata;
};

const loadFile = async (resourceName: string, client: StorageClient, key: string) => {
  const stat = await client.stat(key);

  if (!stat) {
    return {
      status: 404
    };
  }

  const [buffer, attributes] = await Promise.all([client.read(key), readObjectAttributes(resourceName, key)]);

  return {
    status: 200,
    body: buffer,
    headers: {
      ['content-type']: stat.type,
      ...(attributes?.cacheControl && {
        ['cache-control']: attributes.cacheControl
      }),
      ...(attributes?.expires && {
        ['expires']: new Date(attributes.expires).toUTCString()
      })
    }
  };
};

const storeFile = async (client: StorageClient, key: string, buffer: Buffer, headers: Record<string, string>) => {
  const expires = headers['expires'] ? new Date(headers['expires']) : undefined;

  await client.write(key, buffer, {
    contentType: headers['content-type'],
    metadata: getRequestMetadata(headers),
    headers: {
      cacheControl: headers['cache-control'],
      ...(expires && !isNaN(expires.getTime()) && { expires })
    }
  });

  return {
    status: 204
  };
};

const headFile = async (client: StorageClient, key: string) => {
  const stat = await client.stat(key);

  if (!stat) {
    return {
      status: 404
    };
  }

  return {
    status: 200,
    headers: {
      ['content-length']: stat.size.toString(),
      ['content-type']: stat.type
    }
  };
};
