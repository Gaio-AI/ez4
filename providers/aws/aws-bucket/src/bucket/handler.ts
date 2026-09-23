import type { OperationLogLine, ResourceTags } from '@ez4/aws-common';
import type { LifecycleRule } from '@aws-sdk/client-s3';
import type { StepHandler } from '@ez4/state';
import type { BucketState, BucketResult, BucketParameters } from './types';

import { ExpirationStatus } from '@aws-sdk/client-s3';
import { CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { deepCompare, deepEqual } from '@ez4/utils';

import {
  isBucketEmpty,
  emptyBucket,
  createBucket,
  deleteBucket,
  updateCorsConfiguration,
  deleteCorsConfiguration,
  createLifecycle,
  deleteLifecycle,
  tagBucket
} from './client';

import { StaleObjectTag } from '../object/types';
import { BucketServiceName } from './types';

export const getBucketHandler = (): StepHandler<BucketState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: BucketState, current: BucketState) => {
  return !!candidate.result && candidate.result.bucketName === current.result?.bucketName;
};

const previewResource = (candidate: BucketState, current: BucketState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.bucketName
  };
};

const replaceResource = async (candidate: BucketState, current: BucketState) => {
  if (current.result) {
    throw new ReplaceResourceError(BucketServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate);
};

const createResource = (candidate: BucketState): Promise<BucketResult> => {
  const parameters = candidate.parameters;

  return OperationLogger.logExecution(BucketServiceName, parameters.bucketName, 'creation', async (logger) => {
    const { bucketName } = await createBucket(logger, parameters);

    await checkCorsUpdates(logger, bucketName, parameters, undefined);
    await checkLifecycleUpdates(logger, bucketName, parameters, undefined);
    await checkTagUpdates(logger, bucketName, parameters.tags, undefined);

    return {
      bucketName
    };
  });
};

const updateResource = async (candidate: BucketState, current: BucketState) => {
  const { result, parameters } = candidate;
  const { bucketName } = parameters;

  return OperationLogger.logExecution(BucketServiceName, bucketName, 'updates', async (logger) => {
    if (!result) {
      throw new CorruptedResourceError(BucketServiceName, bucketName);
    }

    await checkCorsUpdates(logger, bucketName, parameters, current.parameters);
    await checkLifecycleUpdates(logger, bucketName, parameters, current.parameters);
    await checkTagUpdates(logger, bucketName, parameters.tags, current.parameters.tags);
  });
};

const deleteResource = async (current: BucketState) => {
  const { result, parameters } = current;

  if (result) {
    const { bucketName } = result;

    return OperationLogger.logExecution(BucketServiceName, bucketName, 'deletion', async (logger) => {
      if (parameters.staleExpireDays) {
        await emptyBucket(logger, bucketName);
      }

      const isEmpty = await isBucketEmpty(logger, bucketName);

      if (isEmpty) {
        await deleteBucket(logger, bucketName);
      }
    });
  }
};

const checkCorsUpdates = async (
  logger: OperationLogLine,
  bucketName: string,
  candidate: BucketParameters,
  current: BucketParameters | undefined
) => {
  if (candidate.cors && current?.cors && deepEqual(candidate.cors, current.cors)) {
    return;
  }

  if (candidate.cors) {
    return updateCorsConfiguration(logger, bucketName, candidate.cors);
  }

  if (current?.cors) {
    return deleteCorsConfiguration(logger, bucketName);
  }
};

const getLifecycleRules = ({ autoExpireDays, staleExpireDays }: BucketParameters) => {
  const rules: LifecycleRule[] = [];

  if (autoExpireDays) {
    rules.push({
      ID: 'ez4-auto-expire',
      Status: ExpirationStatus.Enabled,
      Filter: {
        Prefix: ''
      },
      Expiration: {
        Days: autoExpireDays
      }
    });
  }

  if (staleExpireDays) {
    rules.push({
      ID: 'ez4-stale-expire',
      Status: ExpirationStatus.Enabled,
      Filter: {
        Tag: {
          Key: StaleObjectTag.key,
          Value: StaleObjectTag.value
        }
      },
      Expiration: {
        Days: staleExpireDays
      }
    });
  }

  return rules;
};

const checkLifecycleUpdates = async (
  logger: OperationLogLine,
  bucketName: string,
  candidate: BucketParameters,
  current: BucketParameters | undefined
) => {
  if (candidate.autoExpireDays === current?.autoExpireDays && candidate.staleExpireDays === current?.staleExpireDays) {
    return;
  }

  const rules = getLifecycleRules(candidate);

  // PutBucketLifecycleConfiguration replaces every rule, so the whole list is always sent.
  if (rules.length) {
    return createLifecycle(logger, bucketName, rules);
  }

  if (current?.autoExpireDays || current?.staleExpireDays) {
    return deleteLifecycle(logger, bucketName);
  }
};

const checkTagUpdates = async (
  logger: OperationLogLine,
  bucketName: string,
  candidate: ResourceTags | undefined,
  current: ResourceTags | undefined
) => {
  const newTags = candidate ?? {};
  const hasChanges = !deepEqual(newTags, current ?? {});

  if (hasChanges) {
    await tagBucket(logger, bucketName, newTags);
  }
};
