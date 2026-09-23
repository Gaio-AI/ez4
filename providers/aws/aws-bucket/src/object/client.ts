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

export const putObject = async (logger: OperationLogLine, bucketName: string, request: ObjectParameters): Promise<CreateResponse> => {
  logger.update(`Creating object`);

  const { objectKey, filePath, cacheControl } = request;

  const contentType = mime.getType(filePath);

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

    return true;
  } catch (error) {
    if (!(error instanceof NoSuchBucket) && !(error instanceof NoSuchKey)) {
      throw error;
    }

    return false;
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
