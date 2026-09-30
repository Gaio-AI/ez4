import type { EmulateServiceContext, EmulatorRequestEvent, EmulatorResponse } from '@ez4/project/library';
import type { CdnBucketOrigin } from '@ez4/distribution/library';
import type { Client } from '@ez4/storage';

import mime from 'mime';

import { isAnyObject } from '@ez4/utils';

import { getBucketErrorResponse } from '../utils/response';
import { getOriginPath } from '../utils/behavior';

export const sendBucketRequest = async (
  origin: CdnBucketOrigin,
  context: EmulateServiceContext,
  request: EmulatorRequestEvent
): Promise<EmulatorResponse> => {
  const { method, path } = request;

  // The deploy grants the distribution nothing beyond `s3:GetObject` and `s3:ListBucket` on the bucket.
  if (method !== 'GET' && method !== 'HEAD') {
    return getBucketErrorResponse(403, 'AccessDenied', 'Access Denied');
  }

  const objectKey = getObjectKey(origin, path);

  if (objectKey === undefined) {
    return getBucketErrorResponse(400, 'InvalidURI', `Couldn't parse the specified URI.`);
  }

  const client = context.makeClient(origin.bucket) as Client;
  const objectStat = await getObjectStat(client, objectKey);

  // Having `s3:ListBucket`, the distribution gets 404 for a missing object instead of 403.
  if (!objectStat) {
    return getBucketErrorResponse(404, 'NoSuchKey', 'The specified key does not exist.', objectKey);
  }

  // S3 answers the content type stored on upload, which the deploy and the bucket client take from the key
  // extension. The local bucket stores none, so the type it detects from the content only fills unknown extensions.
  const contentType = mime.getType(objectKey) ?? objectStat.type;

  if (method === 'HEAD') {
    return {
      status: 200,
      headers: {
        ['content-type']: contentType,
        ['content-length']: `${objectStat.size}`
      }
    };
  }

  return {
    status: 200,
    headers: {
      ['content-type']: contentType
    },
    body: await client.read(objectKey)
  };
};

const getObjectKey = (origin: CdnBucketOrigin, path: string) => {
  try {
    return decodeURIComponent(`${getOriginPath(origin)}${path}`).substring(1);
  } catch (error) {
    if (!(error instanceof URIError)) {
      throw error;
    }

    return undefined;
  }
};

const getObjectStat = async (client: Client, objectKey: string) => {
  try {
    return await client.stat(objectKey);
  } catch (error) {
    // A key naming a folder of the local bucket isn't an object.
    if (!isAnyObject(error) || error.code !== 'EISDIR') {
      throw error;
    }

    return undefined;
  }
};
