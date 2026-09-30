import type { _Record } from '@aws-sdk/client-dynamodb-streams';
import type { Database, StreamDeleteChange, StreamInsertChange, StreamUpdateChange } from '@ez4/database';
import type { ObjectSchema } from '@ez4/schema';
import type { AnyObject } from '@ez4/utils';

import { unmarshall } from '@aws-sdk/util-dynamodb';
import { validateSchema } from '@ez4/aws-dynamodb/runtime';
import { createTransformContext, transform } from '@ez4/transform';
import { StreamChangeType } from '@ez4/database';

// It mirrors the record conversion of `lib/stream.ts`, the stream function template: importing a shared
// module there changes the bundle of every deployed stream function.
export const getRecordChange = async (record: _Record, schema: ObjectSchema) => {
  const { dynamodb } = record;

  // DynamoDB Local reports the removals of its own TTL with this event name.
  const eventName: string | undefined = record.eventName;

  switch (eventName) {
    case 'INSERT': {
      if (dynamodb?.NewImage) {
        return getInsertChange(dynamodb.NewImage, schema);
      }

      break;
    }

    case 'MODIFY': {
      if (dynamodb?.NewImage && dynamodb?.OldImage) {
        return getUpdateChange(dynamodb.NewImage, dynamodb.OldImage, schema);
      }

      break;
    }

    case 'REMOVE': {
      if (dynamodb?.OldImage) {
        return getDeleteChange(dynamodb.OldImage, schema);
      }

      break;
    }

    case 'UNKNOWN_TO_SDK_VERSION': {
      if (dynamodb?.OldImage && !dynamodb.NewImage) {
        return getDeleteChange(dynamodb.OldImage, schema);
      }

      break;
    }
  }

  return null;
};

const getInsertChange = async (newImage: AnyObject, schema: ObjectSchema) => {
  const record = transformRecord(unmarshall(newImage), schema);

  await validateSchema(record, schema);

  return {
    type: StreamChangeType.Insert,
    record
  } satisfies StreamInsertChange<Database.Schema>;
};

const getUpdateChange = async (newImage: AnyObject, oldImage: AnyObject, schema: ObjectSchema) => {
  const newRecord = transformRecord(unmarshall(newImage), schema);
  const oldRecord = transformRecord(unmarshall(oldImage), schema);

  await Promise.all([validateSchema(newRecord, schema), validateSchema(oldRecord, schema)]);

  return {
    type: StreamChangeType.Update,
    newRecord,
    oldRecord
  } satisfies StreamUpdateChange<Database.Schema>;
};

const getDeleteChange = async (oldImage: AnyObject, schema: ObjectSchema) => {
  const record = transformRecord(unmarshall(oldImage), schema);

  await validateSchema(record, schema);

  return {
    type: StreamChangeType.Delete,
    record
  } satisfies StreamDeleteChange<Database.Schema>;
};

const transformRecord = (input: AnyObject, schema: ObjectSchema) => {
  const record = transform(input, schema, createTransformContext({ convert: false }));

  return record as AnyObject;
};
