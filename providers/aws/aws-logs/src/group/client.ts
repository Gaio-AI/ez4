import type { Arn, OperationLogLine, ResourceTags } from '@ez4/aws-common';

import {
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  PutRetentionPolicyCommand,
  DeleteRetentionPolicyCommand,
  TagResourceCommand,
  UntagResourceCommand,
  ResourceAlreadyExistsException,
  ResourceNotFoundException,
  DescribeLogStreamsCommand
} from '@aws-sdk/client-cloudwatch-logs';

import { getCloudWatchLogsClient } from '../utils/deploy';
import { getLogGroupArn } from '../utils/group';
import { hasUnexpiredLogs } from './utils';

export type CreateRequest = {
  groupName: string;
  tags?: ResourceTags;
};

export type CreateResponse = {
  groupArn: Arn;
};

export const createGroup = async (logger: OperationLogLine, request: CreateRequest): Promise<CreateResponse> => {
  logger.update(`Creating log group`);

  const { groupName } = request;

  try {
    await getCloudWatchLogsClient().send(
      new CreateLogGroupCommand({
        logGroupName: groupName,
        tags: {
          ...request.tags,
          ManagedBy: 'EZ4'
        }
      })
    );
  } catch (error) {
    if (!(error instanceof ResourceAlreadyExistsException)) {
      throw error;
    }
  }

  const groupArn = await getLogGroupArn(groupName);

  return {
    groupArn
  };
};

export const putLogRetention = async (logger: OperationLogLine, groupName: string, retention: number) => {
  logger.update(`Updating log group retention`);

  return getCloudWatchLogsClient().send(
    new PutRetentionPolicyCommand({
      retentionInDays: retention,
      logGroupName: groupName
    })
  );
};

export const deleteLogRetention = async (logger: OperationLogLine, groupName: string) => {
  logger.update(`Deleting log group retention`);

  await getCloudWatchLogsClient().send(
    new DeleteRetentionPolicyCommand({
      logGroupName: groupName
    })
  );
};

export const tagGroup = async (logger: OperationLogLine, groupArn: Arn, tags: ResourceTags) => {
  logger.update(`Tag log group`);

  await getCloudWatchLogsClient().send(
    new TagResourceCommand({
      resourceArn: groupArn,
      tags: {
        ...tags,
        ManagedBy: 'EZ4'
      }
    })
  );
};

export const untagGroup = async (logger: OperationLogLine, groupArn: Arn, tagKeys: string[]) => {
  logger.update(`Untag log group`);

  await getCloudWatchLogsClient().send(
    new UntagResourceCommand({
      resourceArn: groupArn,
      tagKeys
    })
  );
};

/**
 * A log group can go once it holds no event its retention has yet to expire. Its streams are no
 * answer: CloudWatch keeps a stream after all of its events expire, so a group that ever logged has
 * streams for good. Neither is `storedBytes`, which lags behind fresh events. What decides is the
 * newest stream's activity against the retention the group was deployed with.
 */
export const canDeleteGroup = async (logger: OperationLogLine, groupName: string, retentionInDays: number | undefined) => {
  logger.update(`Validating deletion`);

  try {
    const { logStreams } = await getCloudWatchLogsClient().send(
      new DescribeLogStreamsCommand({
        logGroupName: groupName,
        orderBy: 'LastEventTime',
        descending: true,
        limit: 1
      })
    );

    const [stream] = logStreams ?? [];

    // The event timestamps are eventually consistent; the stream's creation is not, and it bounds the
    // activity of a stream whose events haven't been accounted yet.
    const lastActivity = stream && Math.max(stream.lastEventTimestamp ?? 0, stream.lastIngestionTime ?? 0, stream.creationTime ?? 0);

    return !hasUnexpiredLogs(retentionInDays, lastActivity || undefined);
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }

    return true;
  }
};

export const deleteGroup = async (logger: OperationLogLine, groupName: string) => {
  logger.update(`Deleting log group`);

  try {
    await getCloudWatchLogsClient().send(
      new DeleteLogGroupCommand({
        logGroupName: groupName
      })
    );

    return true;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }

    return false;
  }
};
