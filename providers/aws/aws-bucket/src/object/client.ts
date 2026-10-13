import type { OperationLogLine, ResourceTags } from '@ez4/aws-common';
import type { ObjectParameters } from './types';

import { createReadStream } from 'node:fs';

import {
  PutObjectCommand,
  PutObjectTaggingCommand,
  GetObjectTaggingCommand,
  DeleteObjectCommand,
  NoSuchBucket,
  NoSuchKey
} from '@aws-sdk/client-s3';

import { getTagList } from '@ez4/aws-common';

import { getS3Client } from '../utils/deploy';
import { StaleObjectTag } from './types';

import mime from 'mime';

export type CreateRequest = {
  filePath: string;
  objectKey: string;
};

export type CreateResponse = {
  objectKey: string;
};

const TEXT_APPLICATION_TYPES = new Set([
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/manifest+json',
  'application/xml',
  'application/yaml',
  'image/svg+xml'
]);

/**
 * The media type of a deployed file, naming UTF-8 for a text one: without a charset a browser guesses
 * the encoding of a plain-text or Markdown file, and reads accents as mojibake. What a bucket deploys
 * is built text, written in UTF-8.
 */
export const getContentType = (filePath: string) => {
  const contentType = mime.getType(filePath);

  if (contentType && (contentType.startsWith('text/') || TEXT_APPLICATION_TYPES.has(contentType))) {
    return `${contentType}; charset=utf-8`;
  }

  return contentType;
};

export const putObject = async (logger: OperationLogLine, bucketName: string, request: ObjectParameters): Promise<CreateResponse> => {
  logger.update(`Creating object`);

  const { objectKey, filePath, cacheControl } = request;

  const contentType = getContentType(filePath);

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: createReadStream(filePath),
      ...(contentType && {
        ContentType: contentType
      }),
      ...(cacheControl && {
        CacheControl: cacheControl
      })
    })
  );

  return {
    objectKey
  };
};

export const updateTags = async (logger: OperationLogLine, bucketName: string, objectKey: string, tags: ResourceTags) => {
  logger.update(`Updating object tags`);

  await getS3Client().send(
    new PutObjectTaggingCommand({
      Bucket: bucketName,
      Key: objectKey,
      Tagging: {
        TagSet: getTagList({
          ...tags,
          ManagedBy: 'EZ4'
        })
      }
    })
  );
};

export const tagStaleObject = async (logger: OperationLogLine, bucketName: string, objectKey: string) => {
  logger.update(`Tagging stale object`);

  const client = getS3Client();

  try {
    const { TagSet = [] } = await client.send(
      new GetObjectTaggingCommand({
        Bucket: bucketName,
        Key: objectKey
      })
    );

    await client.send(
      new PutObjectTaggingCommand({
        Bucket: bucketName,
        Key: objectKey,
        Tagging: {
          TagSet: [
            ...TagSet.filter(({ Key }) => Key !== StaleObjectTag.key),
            {
              Key: StaleObjectTag.key,
              Value: StaleObjectTag.value
            }
          ]
        }
      })
    );
  } catch (error) {
    if (!(error instanceof NoSuchBucket) && !(error instanceof NoSuchKey)) {
      throw error;
    }
  }
};

export const deleteObject = async (logger: OperationLogLine, bucketName: string, objectKey: string) => {
  logger.update(`Deleting object`);

  try {
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: objectKey
      })
    );

    return true;
  } catch (error) {
    if (!(error instanceof NoSuchBucket)) {
      throw error;
    }

    return false;
  }
};
