import type { AllType, EveryType, ModelProperty, ReflectionTypes, TypeModel, TypeObject } from '@ez4/reflection';
import type { MemberType } from '@ez4/common/library';
import type { ObjectSchema } from '@ez4/schema';
import type { Incomplete } from '@ez4/utils';
import type { DatabaseTable, TableIndex, TableRenames, TableTimestamps } from './types';

import {
  InvalidServicePropertyError,
  isModelDeclaration,
  getModelMembers,
  getObjectMembers,
  getPropertyObject,
  getPropertyString,
  getReferenceType,
  getPropertyTuple,
  getTupleElements,
  hasHeritageType
} from '@ez4/common/library';

import { isModelProperty, isTypeObject, isTypeReference, isTypeTuple } from '@ez4/reflection';
import { isEmptyObject, isObjectWith } from '@ez4/utils';
import { isStringSchema } from '@ez4/schema';

import {
  IncompleteTableError,
  IncorrectTableTypeError,
  InvalidTableRenameError,
  InvalidTableTimestampsError,
  InvalidTableTypeError
} from '../errors/table';
import { Index } from '../types/index';
import { InvalidIndexReferenceError } from '../errors/indexes';
import { getTableRelationsMetadata } from './relations';
import { getTableIndexesMetadata } from './indexes';
import { getTableSchemaMetadata } from './schema';
import { getTableStreamMetadata } from './stream';

export const isDatabaseTableDeclaration = (type: TypeModel) => {
  return hasHeritageType(type, 'Database.Table');
};

export const getDatabaseTablesMetadata = (member: ModelProperty, parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  if (!isTypeReference(member.value)) {
    return getTableFromTuple(getPropertyTuple(member) ?? [], parent, reflection, errorList);
  }

  const declaration = getReferenceType(member.value, reflection);

  if (declaration && isTypeTuple(declaration)) {
    return getTableFromTuple(getTupleElements(declaration), parent, reflection, errorList);
  }

  return undefined;
};

const getTableFromTuple = (tableItems: EveryType[], parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  const tableList: DatabaseTable[] = [];

  for (const table of tableItems) {
    const result = getTypeFromTable(table, parent, reflection, errorList);

    if (result) {
      tableList.push(result);
    }
  }

  return tableList;
};

const getTypeFromTable = (type: AllType, parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  if (!isTypeReference(type)) {
    return getTableType(type, parent, reflection, errorList);
  }

  const declaration = getReferenceType(type, reflection);

  if (declaration) {
    return getTableType(declaration, parent, reflection, errorList);
  }

  return undefined;
};

const isCompleteTable = (type: Incomplete<DatabaseTable>): type is DatabaseTable => {
  return isObjectWith(type, ['name', 'schema', 'indexes']);
};

const getTableType = (type: AllType, parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  if (isTypeObject(type)) {
    return getTypeFromMembers(type, parent, getObjectMembers(type), reflection, errorList);
  }

  if (!isModelDeclaration(type)) {
    errorList.push(new InvalidTableTypeError(parent.file));
    return undefined;
  }

  if (!isDatabaseTableDeclaration(type)) {
    errorList.push(new IncorrectTableTypeError(type.name, type.file));
    return undefined;
  }

  return getTypeFromMembers(type, parent, getModelMembers(type), reflection, errorList);
};

const getTypeFromMembers = (
  type: TypeObject | TypeModel,
  parent: TypeModel,
  members: MemberType[],
  reflection: ReflectionTypes,
  errorList: Error[]
) => {
  const table: Incomplete<DatabaseTable> = {};
  const properties = new Set(['name', 'schema', 'indexes']);

  let renamesMember: ModelProperty | undefined;
  let timestampsMember: ModelProperty | undefined;

  for (const member of members) {
    if (!isModelProperty(member) || member.inherited) {
      continue;
    }

    switch (member.name) {
      default: {
        errorList.push(new InvalidServicePropertyError(parent.name, member.name, type.file));
        break;
      }

      case 'name': {
        if ((table.name = getPropertyString(member))) {
          properties.delete(member.name);
        }
        break;
      }

      case 'schema': {
        if ((table.schema = getTableSchemaMetadata(member.value, type, reflection, errorList))) {
          properties.delete(member.name);
        }
        break;
      }

      case 'indexes': {
        if ((table.indexes = getTableIndexesMetadata(member.value, type, reflection, errorList))) {
          properties.delete(member.name);
        }
        break;
      }

      case 'relations': {
        table.relations = getTableRelationsMetadata(member.value, type, reflection, errorList);
        break;
      }

      case 'stream': {
        table.stream = getTableStreamMetadata(member.value, parent, reflection, errorList);
        break;
      }

      case 'renamedFrom': {
        renamesMember = member;
        break;
      }

      case 'timestamps': {
        timestampsMember = member;
        break;
      }
    }
  }

  if (!isCompleteTable(table)) {
    errorList.push(new IncompleteTableError([...properties], type.file));
    return undefined;
  }

  if (renamesMember && !(table.renamedFrom = getTableRenames(type, renamesMember, table, errorList))) {
    return undefined;
  }

  if (timestampsMember) {
    const timestamps = getTableTimestamps(type, timestampsMember, table, errorList);

    if (!timestamps) {
      return undefined;
    }

    // Declaring none is the same as not declaring the option, and leaves the table metadata as it was.
    if (!isEmptyObject(timestamps)) {
      table.timestamps = timestamps;
    }
  }

  const indexErrors = validateIndexes(type, table.indexes, table.schema);

  if (indexErrors.length) {
    errorList.push(...indexErrors);
    return undefined;
  }

  return table;
};

/**
 * The previous names of the table and of its columns. A renamed column is in the schema and its previous
 * name isn't, since the migration would otherwise rename it onto a column that exists, and each previous
 * name becomes one column only.
 */
const getTableRenames = (type: TypeObject | TypeModel, member: ModelProperty, table: DatabaseTable, errorList: Error[]) => {
  const renamesObject = getPropertyObject(member);

  if (!renamesObject) {
    errorList.push(new InvalidTableRenameError(table.name, member.name, type.file));
    return undefined;
  }

  const renames: TableRenames = {};

  for (const option of getObjectMembers(renamesObject)) {
    if (!isModelProperty(option)) {
      continue;
    }

    switch (option.name) {
      case 'table': {
        if (!(renames.table = getPropertyString(option))) {
          errorList.push(new InvalidTableRenameError(table.name, option.name, type.file));
          return undefined;
        }

        break;
      }

      case 'columns': {
        if (!(renames.columns = getColumnRenames(type, option, table, errorList))) {
          return undefined;
        }

        break;
      }

      default: {
        errorList.push(new InvalidTableRenameError(table.name, option.name, type.file));
        return undefined;
      }
    }
  }

  return renames;
};

const getColumnRenames = (type: TypeObject | TypeModel, member: ModelProperty, table: DatabaseTable, errorList: Error[]) => {
  const columnsObject = getPropertyObject(member);

  if (!columnsObject) {
    errorList.push(new InvalidTableRenameError(table.name, member.name, type.file));
    return undefined;
  }

  const allColumns = table.schema.properties;
  const renames: Record<string, string> = {};
  const errors: Error[] = [];

  for (const column of getObjectMembers(columnsObject)) {
    if (!isModelProperty(column)) {
      continue;
    }

    const previousName = getPropertyString(column);

    const isRepeated = Object.values(renames).includes(previousName ?? '');

    if (!previousName || !allColumns[column.name] || allColumns[previousName] || isRepeated) {
      errors.push(new InvalidTableRenameError(table.name, column.name, type.file));
      continue;
    }

    renames[column.name] = previousName;
  }

  if (errors.length) {
    errorList.push(...errors);
    return undefined;
  }

  return renames;
};

/**
 * The columns the database writes for the table: `created` on insert, and `updated` on insert and on every
 * update. Each one is a required date-time column that isn't the primary key, and a column the migration
 * renames can't be one, since the trigger writing it would lose the column while both versions run.
 */
const getTableTimestamps = (type: TypeObject | TypeModel, member: ModelProperty, table: DatabaseTable, errorList: Error[]) => {
  const timestampsObject = getPropertyObject(member);

  if (!timestampsObject) {
    errorList.push(new InvalidTableTimestampsError(table.name, member.name, 'it has to be an object', type.file));
    return undefined;
  }

  const timestamps: TableTimestamps = {};
  const errors: Error[] = [];

  for (const option of getObjectMembers(timestampsObject)) {
    if (!isModelProperty(option)) {
      continue;
    }

    if (option.name !== 'created' && option.name !== 'updated') {
      errors.push(
        new InvalidTableTimestampsError(table.name, option.name, 'only created and updated are written by the database', type.file)
      );
      continue;
    }

    const column = getPropertyString(option);

    if (!column) {
      errors.push(new InvalidTableTimestampsError(table.name, option.name, 'it has to name a column', type.file));
      continue;
    }

    const reason = getTimestampColumnError(table, column);

    if (reason) {
      errors.push(new InvalidTableTimestampsError(table.name, option.name, reason, type.file));
      continue;
    }

    timestamps[option.name] = column;
  }

  if (timestamps.created && timestamps.created === timestamps.updated) {
    errors.push(
      new InvalidTableTimestampsError(table.name, 'updated', `column ${timestamps.updated} is the created timestamp too`, type.file)
    );
  }

  if (errors.length) {
    errorList.push(...errors);
    return undefined;
  }

  return timestamps;
};

const getTimestampColumnError = (table: DatabaseTable, column: string) => {
  const columnSchema = table.schema.properties[column];

  if (!columnSchema) {
    return `column ${column} isn't in the schema`;
  }

  if (!isStringSchema(columnSchema) || columnSchema.format !== 'date-time') {
    return `column ${column} isn't a date-time`;
  }

  if (columnSchema.optional || columnSchema.nullable) {
    return `column ${column} is optional or nullable`;
  }

  if (table.indexes.some(({ type, columns }) => type === Index.Primary && columns.includes(column))) {
    return `column ${column} is in the primary key`;
  }

  if (table.renamedFrom?.columns?.[column]) {
    return `column ${column} is renamed, which needs a deploy without timestamps on it`;
  }

  return undefined;
};

const validateIndexes = (type: TypeObject | TypeModel, indexes: TableIndex[], schema: ObjectSchema) => {
  const allColumns = schema.properties;
  const errorList = [];

  for (const { name, columns, options } of indexes) {
    const referencedColumns = [...columns, ...(options?.include ?? []), ...Object.keys(options?.where ?? {})];

    // An index sorts only its own columns.
    const orderedColumns = Object.keys(options?.order ?? {});

    const hasMissing = referencedColumns.some((columnName) => !allColumns[columnName]);
    const hasForeignOrder = orderedColumns.some((columnName) => !columns.includes(columnName));

    if (hasMissing || hasForeignOrder) {
      errorList.push(new InvalidIndexReferenceError(name, type.file));
    }
  }

  return errorList;
};
