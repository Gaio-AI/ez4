import type { Arn, OperationLogLine, ResourceTags } from '@ez4/aws-common';

import {
  CreateAliasCommand,
  CreateKeyCommand,
  DeleteAliasCommand,
  DescribeKeyCommand,
  EnableKeyRotationCommand,
  NotFoundException,
  ScheduleKeyDeletionCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateKeyDescriptionCommand
} from '@aws-sdk/client-kms';

import { getKmsClient } from '../utils/deploy';

/**
 * How long a deleted key waits before KMS destroys it, the longest it allows: whatever it encrypted
 * is lost with it, and cancelling the deletion in that time brings everything back.
 */
const DELETION_WINDOW_DAYS = 30;

export type CreateRequest = {
  aliasName: string;
  description?: string;
  tags?: ResourceTags;
};

export type ImportOrCreateResponse = {
  keyId: string;
  keyArn: Arn;
};

const getKmsTags = (tags: ResourceTags | undefined) => {
  return Object.entries({ ...tags, ManagedBy: 'EZ4' }).map(([TagKey, TagValue]) => ({ TagKey, TagValue }));
};

export const importKey = async (logger: OperationLogLine | undefined, aliasName: string): Promise<ImportOrCreateResponse | undefined> => {
  logger?.update(`Importing key`);

  try {
    const { KeyMetadata } = await getKmsClient().send(
      new DescribeKeyCommand({
        KeyId: aliasName
      })
    );

    if (!KeyMetadata?.KeyId || !KeyMetadata.Arn) {
      return undefined;
    }

    return {
      keyId: KeyMetadata.KeyId,
      keyArn: KeyMetadata.Arn as Arn
    };
  } catch (error) {
    if (!(error instanceof NotFoundException)) {
      throw error;
    }

    return undefined;
  }
};

export const createKey = async (logger: OperationLogLine, request: CreateRequest): Promise<ImportOrCreateResponse> => {
  logger.update(`Creating key`);

  const { aliasName, description, tags } = request;

  const client = getKmsClient();

  const { KeyMetadata } = await client.send(
    new CreateKeyCommand({
      Description: description,
      KeySpec: 'SYMMETRIC_DEFAULT',
      KeyUsage: 'ENCRYPT_DECRYPT',
      Tags: getKmsTags(tags)
    })
  );

  const keyId = KeyMetadata?.KeyId;
  const keyArn = KeyMetadata?.Arn as Arn;

  if (!keyId || !keyArn) {
    throw new Error(`KMS created no key for '${aliasName}'.`);
  }

  // The alias comes last: a retry imports whatever key the alias names, so it may only ever name
  // a key that is ready.
  logger.update(`Enabling key rotation`);

  await client.send(
    new EnableKeyRotationCommand({
      KeyId: keyId
    })
  );

  logger.update(`Creating key alias`);

  await client.send(
    new CreateAliasCommand({
      AliasName: aliasName,
      TargetKeyId: keyId
    })
  );

  return {
    keyId,
    keyArn
  };
};

export const updateKeyDescription = async (logger: OperationLogLine, keyId: string, description: string | undefined) => {
  logger.update(`Update key description`);

  await getKmsClient().send(
    new UpdateKeyDescriptionCommand({
      KeyId: keyId,
      Description: description ?? ''
    })
  );
};

export const tagKey = async (logger: OperationLogLine, keyId: string, tags: ResourceTags) => {
  logger.update(`Tag key`);

  await getKmsClient().send(
    new TagResourceCommand({
      KeyId: keyId,
      Tags: getKmsTags(tags)
    })
  );
};

export const untagKey = async (logger: OperationLogLine, keyId: string, tagKeys: string[]) => {
  logger.update(`Untag key`);

  await getKmsClient().send(
    new UntagResourceCommand({
      KeyId: keyId,
      TagKeys: tagKeys
    })
  );
};

const ignoreNotFound = (error: unknown) => {
  if (!(error instanceof NotFoundException)) {
    throw error;
  }
};

export const deleteKey = async (logger: OperationLogLine, keyId: string, aliasName: string) => {
  logger.update(`Delete key`);

  const client = getKmsClient();

  // Each step on its own: a retry after the alias is gone still schedules the key's deletion.
  await client
    .send(
      new DeleteAliasCommand({
        AliasName: aliasName
      })
    )
    .catch(ignoreNotFound);

  await client
    .send(
      new ScheduleKeyDeletionCommand({
        KeyId: keyId,
        PendingWindowInDays: DELETION_WINDOW_DAYS
      })
    )
    .catch(ignoreNotFound);
};
