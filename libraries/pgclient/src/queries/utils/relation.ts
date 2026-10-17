import type { ObjectSchema } from '@ez4/schema';

import { isAnyObject } from '@ez4/utils';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

/**
 * The record holds the relation when the foreign key is its own column: the related column is a primary key, or a
 * unique key that doesn't point back to the record's primary key. A relation between two unique keys or two primary
 * keys is held by the table that declares it, as the relation types expect, so (re)connecting it writes that column
 * instead of the key of the related records.
 */
export const isRelationHolder = (sourceIndex: Index | undefined, targetIndex: Index | undefined) => {
  return sourceIndex === Index.Primary || (sourceIndex === Index.Unique && targetIndex !== Index.Primary);
};

/**
 * New related records are created after the record when they hold the relation, pointing to its primary or unique key.
 */
export const isPostCreationRelation = (sourceIndex: Index | undefined, targetIndex: Index | undefined) => {
  return !isRelationHolder(sourceIndex, targetIndex) && (targetIndex === Index.Primary || targetIndex === Index.Unique);
};

export const isSingleRelationData = (value: unknown) => {
  return isAnyObject(value);
};

export const isMultipleRelationData = (value: unknown) => {
  return Array.isArray(value);
};

export const isRelationalData = (value: unknown): boolean => {
  return isSingleRelationData(value) || isMultipleRelationData(value);
};

export const getTargetCreationSchema = (schema: ObjectSchema, sourceColumn: string) => {
  const sourceProperties = {
    ...schema.properties
  };

  delete sourceProperties[sourceColumn];

  return {
    type: SchemaType.Object,
    properties: sourceProperties
  };
};

export const getSourceCreationSchema = (schema: ObjectSchema, sourceColumn: string) => {
  const sourceSchema = schema.properties[sourceColumn];

  if (!sourceSchema.nullable && !sourceSchema.optional) {
    return schema;
  }

  return {
    type: SchemaType.Object,
    properties: {
      ...schema.properties,
      [sourceColumn]: {
        ...sourceSchema,
        nullable: false,
        optional: false
      }
    }
  };
};

export const getConnectionSchema = (schema: ObjectSchema, columnName: string): ObjectSchema => {
  return {
    type: SchemaType.Object,
    properties: {
      [columnName]: {
        ...schema.properties[columnName],
        nullable: true,
        optional: true
      }
    }
  };
};
