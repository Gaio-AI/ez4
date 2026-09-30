import type { QueueImport, QueueService } from '@ez4/queue/library';
import type { MessageTrace } from '@ez4/local-common';
import type { AnyObject } from '@ez4/utils';

import { createHash } from 'node:crypto';

import { getJsonStringMessage } from '@ez4/queue/utils';
import { getRandomUUID } from '@ez4/utils';

import { InvalidParameterValueError } from './errors';
import { getMessageGroupId } from './group';

export type MessageAttributes = {
  traceId: string;
  scope?: string;
};

export type OutgoingMessage = {
  body: string;
  attributes: MessageAttributes;
  groupId?: string;
  deduplicationId?: string;
  delay?: number;
};

const MAX_MESSAGE_SIZE = 1048576;

const MAX_MESSAGE_DELAY = 900;

// Printable ASCII but the space: the letters, digits and punctuation SQS takes in group and deduplication ids.
const MESSAGE_ID_PATTERN = /^[\x21-\x7e]{1,128}$/;

const DELAY_HEADER = 'x-ez4-delay';

export const getOutgoingMessage = async (
  message: AnyObject,
  service: QueueService | QueueImport,
  trace: MessageTrace,
  delay?: number
): Promise<OutgoingMessage> => {
  // The real client validates the message first, then reads the group and deduplication ids from the message as sent.
  const body = await getJsonStringMessage(message, service.schema);

  const groupId = getMessageGroupId(message, service);
  const deduplicationId = service.fifoMode && getDeduplicationId(message, service.fifoMode.uniqueId, body);

  // The real client always sends a trace id, and the message keeps it on every attempt.
  const attributes = {
    traceId: trace.traceId ?? getRandomUUID(),
    scope: trace.scope
  };

  if (delay !== undefined) {
    assertMessageDelay(delay, !!service.fifoMode);
  }

  if (groupId !== undefined) {
    assertMessageId('MessageGroupId', groupId);
  }

  if (deduplicationId !== undefined) {
    assertMessageId('MessageDeduplicationId', deduplicationId);
  }

  if (getMessageSize(body, attributes) > MAX_MESSAGE_SIZE) {
    throw new InvalidParameterValueError(`Message must be shorter than ${MAX_MESSAGE_SIZE} bytes.`);
  }

  return {
    body,
    attributes,
    groupId,
    deduplicationId,
    delay
  };
};

export const getMessageDelayHeaders = (delay: number | undefined): Record<string, string> => {
  if (delay === undefined) {
    return {};
  }

  return {
    [DELAY_HEADER]: `${delay}`
  };
};

export const getMessageDelayFromHeaders = (headers: Record<string, string> | undefined) => {
  const delay = headers?.[DELAY_HEADER];

  if (delay === undefined) {
    return undefined;
  }

  return Number(delay);
};

const getDeduplicationId = (message: AnyObject, uniqueId: string | undefined, body: string) => {
  const uniqueValue = uniqueId && message[uniqueId];

  // Without a unique id value the queue deduplicates by content, with the SHA-256 of the body.
  if (!uniqueValue) {
    return createHash('sha256').update(body).digest('hex');
  }

  return `${uniqueValue}`;
};

const assertMessageDelay = (delay: number, fifoMode: boolean) => {
  if (fifoMode) {
    throw new InvalidParameterValueError('The request include parameter that is not valid for this queue type.', 'DelaySeconds', delay);
  }

  if (!Number.isFinite(delay) || delay < 0 || delay > MAX_MESSAGE_DELAY) {
    throw new InvalidParameterValueError(`DelaySeconds must be >= 0 and <= ${MAX_MESSAGE_DELAY}.`, 'DelaySeconds', delay);
  }
};

const assertMessageId = (parameterName: string, value: string) => {
  if (!MESSAGE_ID_PATTERN.test(value)) {
    throw new InvalidParameterValueError(
      `${parameterName} can only include alphanumeric and punctuation characters. 1 to 128 in length.`,
      parameterName,
      value
    );
  }
};

// SQS counts the name, the data type and the value of each message attribute in the message size.
const getMessageSize = (body: string, attributes: MessageAttributes) => {
  const traceSize = getAttributeSize('EZ4.TRACE_ID', attributes.traceId);
  const scopeSize = attributes.scope !== undefined ? getAttributeSize('EZ4.SCOPE', attributes.scope) : 0;

  return Buffer.byteLength(body) + traceSize + scopeSize;
};

const getAttributeSize = (name: string, value: string) => {
  return Buffer.byteLength(name) + Buffer.byteLength('String') + Buffer.byteLength(value);
};
