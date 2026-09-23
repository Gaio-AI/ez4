import type { Arn, OperationLogLine, ResourceTags } from '@ez4/aws-common';
import type { Event, LifecycleRule } from '@aws-sdk/client-s3';
import type { Bucket } from '@ez4/storage';

import { getTagList } from '@ez4/aws-common';
import { Tasks } from '@ez4/utils';

import {
  ListObjectsV2Command,
  CreateBucketCommand,
  DeleteBucketCommand,
  PutBucketTaggingCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  DeleteBucketLifecycleCommand,
  DeleteBucketCorsCommand,
  DeleteObjectsCommand,
  GetObjectTaggingCommand,
  NoSuchBucket,
  NoSuchKey
} from '@aws-sdk/client-s3';

import { getS3Client } from '../utils/deploy';
import { StaleObjectTag } from '../object/types';

export type CreateRequest = {
  bucketName: string;
};

export type CreateResponse = {
  bucketName: string;
};

export type UpdateNotificationRequest = {
  functionArn?: Arn;
  eventsPath?: string;
  eventsType: Event[];
};

export const isBucketEmpty = async (logger: OperationLogLine, bucketName: string) => {
  logger.update(`Fetching bucket`);

  try {
    const response = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        MaxKeys: 1
      })
    );

    return !response.Contents?.length;
  } catch (error) {
    if (!(error instanceof NoSuchBucket)) {
      throw error;
    }

    return 0;
  }
};

const isStaleObject = async (bucketName: string, objectKey: string) => {
  try {
    const { TagSet = [] } = await getS3Client().send(
      new GetObjectTaggingCommand({
        Bucket: bucketName,
        Key: objectKey
      })
    );

    return TagSet.some(({ Key, Value }) => Key === StaleObjectTag.key && Value === StaleObjectTag.value);
  } catch (error) {
    if (!(error instanceof NoSuchKey)) {
      throw error;
    }

    return false;
  }
};

export const deleteStaleObjects = async (logger: OperationLogLine, bucketName: string) => {
  logger.update(`Deleting stale objects`);

  const client = getS3Client();

  let continuationToken: string | undefined;

  try {
    do {
      const { Contents = [], NextContinuationToken } = await client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken
        })
      );

      const objectKeys = Contents.flatMap(({ Key }) => (Key ? [Key] : []));

      const staleKeys = await Tasks.run(
        objectKeys.map((objectKey) => async () => ((await isStaleObject(bucketName, objectKey)) ? [objectKey] : [])),
        { concurrency: 20 }
      );

      const objects = staleKeys.flat().map((Key) => ({ Key }));

      if (objects.length) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
              Objects: objects,
              Quiet: true
            }
          })
        );
      }

      continuationToken = NextContinuationToken;
    } while (continuationToken);
  } catch (error) {
    if (!(error instanceof NoSuchBucket)) {
      throw error;
    }
  }
};

export const createBucket = async (logger: OperationLogLine, request: CreateRequest): Promise<CreateResponse> => {
  logger.update(`Creating bucket`);

  const { bucketName } = request;

  await getS3Client().send(
    new CreateBucketCommand({
      Bucket: bucketName
    })
  );

  return {
    bucketName
  };
};

export const deleteBucket = async (logger: OperationLogLine, bucketName: string) => {
  logger.update(`Deleting bucket`);

  try {
    await getS3Client().send(
      new DeleteBucketCommand({
        Bucket: bucketName
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

export const tagBucket = async (logger: OperationLogLine, bucketName: string, tags: ResourceTags) => {
  logger.update(`Tag bucket`);

  await getS3Client().send(
    new PutBucketTaggingCommand({
      Bucket: bucketName,
      Tagging: {
        TagSet: getTagList({
          ...tags,
          ManagedBy: 'EZ4'
        })
      }
    })
  );
};

export const updateCorsConfiguration = async (logger: OperationLogLine, bucketName: string, cors: Bucket.Cors) => {
  logger.update(`Updating bucket CORS`);

  await getS3Client().send(
    new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: {
        CORSRules: [
          {
            ID: 'ID0',
            AllowedOrigins: cors.allowOrigins,
            AllowedMethods: cors.allowMethods,
            AllowedHeaders: cors.allowHeaders,
            ExposeHeaders: cors.exposeHeaders,
            MaxAgeSeconds: cors.maxAge
          }
        ]
      }
    })
  );
};

export const deleteCorsConfiguration = async (logger: OperationLogLine, bucketName: string) => {
  logger.update(`Deleting bucket CORS`);

  try {
    await getS3Client().send(
      new DeleteBucketCorsCommand({
        Bucket: bucketName
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

export const createLifecycle = async (logger: OperationLogLine, bucketName: string, rules: LifecycleRule[]) => {
  logger.update(`Creating bucket lifecycle`);

  await getS3Client().send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucketName,
      LifecycleConfiguration: {
        Rules: rules
      }
    })
  );
};

export const deleteLifecycle = async (logger: OperationLogLine, bucketName: string) => {
  logger.update(`Deleting bucket lifecycle`);

  try {
    await getS3Client().send(
      new DeleteBucketLifecycleCommand({
        Bucket: bucketName
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
