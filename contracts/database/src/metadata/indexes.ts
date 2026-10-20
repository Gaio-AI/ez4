import type { AllType, ModelProperty, ReflectionTypes, TypeModel, TypeObject } from '@ez4/reflection';
import type { MemberType } from '@ez4/common/library';
import type { IndexMethod, IndexOrder, TableIndex, TableIndexFilters, TableIndexOptions } from './types';

import {
  isModelDeclaration,
  getModelMembers,
  getObjectMembers,
  getPropertyBoolean,
  getPropertyObject,
  getPropertyString,
  getPropertyStringIn,
  getPropertyStringList,
  getReferenceType,
  hasHeritageType
} from '@ez4/common/library';

import { isModelProperty, isTypeNull, isTypeObject, isTypeReference, isTypeScalar, isTypeTuple } from '@ez4/reflection';
import { isEmptyObject } from '@ez4/utils';

import { IncorrectIndexesTypeError, InvalidIndexesTypeError, InvalidIndexOptionError, InvalidIndexTypeError } from '../errors/indexes';
import { Index } from '../types/index';

type TypeParent = TypeModel | TypeObject;

export const isTableIndexesDeclaration = (type: TypeModel) => {
  return hasHeritageType(type, 'Database.Indexes');
};

export const getTableIndexesMetadata = (type: AllType, parent: TypeParent, reflection: ReflectionTypes, errorList: Error[]) => {
  if (!isTypeReference(type)) {
    return getTypeIndexes(type, parent, errorList);
  }

  const declaration = getReferenceType(type, reflection);

  if (declaration) {
    return getTypeIndexes(declaration, parent, errorList);
  }

  return undefined;
};

const getTypeIndexes = (type: AllType, parent: TypeParent, errorList: Error[]) => {
  if (isTypeObject(type)) {
    return getTypeFromMembers(type, getObjectMembers(type), errorList);
  }

  if (!isModelDeclaration(type)) {
    errorList.push(new InvalidIndexesTypeError(parent.file));
    return undefined;
  }

  if (!isTableIndexesDeclaration(type)) {
    errorList.push(new IncorrectIndexesTypeError(type.name, type.file));
    return undefined;
  }

  return getTypeFromMembers(type, getModelMembers(type), errorList);
};

const getTypeFromMembers = (type: TypeObject | TypeModel, members: MemberType[], errorList: Error[]) => {
  const indexes: TableIndex[] = [];

  for (const member of members) {
    if (!isModelProperty(member) || member.inherited) {
      continue;
    }

    const indexName = member.name;
    const indexType = getPropertyString(member);

    if (indexType !== undefined) {
      if (!isIndexType(indexType)) {
        errorList.push(new InvalidIndexTypeError(indexName, type.file));
        return undefined;
      }

      indexes.push({
        name: indexName,
        columns: indexName.split(':'),
        type: indexType
      });

      continue;
    }

    const index = getIndexObject(member, type, errorList);

    if (!index) {
      return undefined;
    }

    indexes.push(index);
  }

  return indexes;
};

const INDEX_TYPES: Index[] = [Index.Primary, Index.Secondary, Index.Unique, Index.TTL];

const INDEX_METHODS: IndexMethod[] = ['btree', 'hash', 'gin', 'gist', 'brin'];

const isIndexType = (value: string): value is Index => {
  return INDEX_TYPES.includes(value as Index);
};

/**
 * An index declared as an object with its type and options. Its columns come from its name, as in the
 * plain form, unless `columns` lists them, which lets two indexes share their columns.
 */
const getIndexObject = (member: ModelProperty, type: TypeObject | TypeModel, errorList: Error[]): TableIndex | undefined => {
  const indexName = member.name;
  const indexObject = getPropertyObject(member);

  if (!indexObject) {
    errorList.push(new InvalidIndexTypeError(indexName, type.file));
    return undefined;
  }

  const options: TableIndexOptions = {};

  let indexType: Index | undefined;
  let indexColumns: string[] | undefined;

  for (const option of getObjectMembers(indexObject)) {
    if (!isModelProperty(option)) {
      continue;
    }

    let isValid = true;

    switch (option.name) {
      case 'type':
        isValid = !!(indexType = getPropertyStringIn(option, INDEX_TYPES));
        break;

      case 'columns':
        isValid = !!(indexColumns = getPropertyStringList(option))?.length;
        break;

      case 'name':
        isValid = !!(options.name = getPropertyString(option));
        break;

      case 'where':
        isValid = !!(options.where = getIndexFilters(option.value));
        break;

      case 'include':
        isValid = !!(options.include = getPropertyStringList(option))?.length;
        break;

      case 'order':
        isValid = !!(options.order = getIndexOrder(option.value));
        break;

      case 'nullsNotDistinct':
        isValid = (options.nullsNotDistinct = getPropertyBoolean(option)) !== undefined;
        break;

      case 'method':
        isValid = !!(options.method = getPropertyStringIn(option, INDEX_METHODS));
        break;

      default:
        isValid = false;
    }

    if (!isValid) {
      errorList.push(new InvalidIndexOptionError(indexName, option.name, type.file));
      return undefined;
    }
  }

  if (!indexType) {
    errorList.push(new InvalidIndexTypeError(indexName, type.file));
    return undefined;
  }

  // A primary key and a TTL take no options besides their columns.
  if ((indexType === Index.Primary || indexType === Index.TTL) && !isEmptyObject(options)) {
    errorList.push(new InvalidIndexOptionError(indexName, Object.keys(options)[0], type.file));
    return undefined;
  }

  return {
    name: indexName,
    columns: indexColumns ?? indexName.split(':'),
    type: indexType,
    ...(!isEmptyObject(options) && { options })
  };
};

const getIndexOrder = (type: AllType) => {
  const order = isTypeObject(type) ? getIndexFilters(type) : undefined;

  if (!order || !Object.values(order).every((value) => value === 'asc' || value === 'desc')) {
    return undefined;
  }

  return order as Record<string, IndexOrder>;
};

/**
 * Literal values of a filter type: scalars, null, objects and tuples of them.
 */
const getIndexFilters = (type: AllType): TableIndexFilters | undefined => {
  if (!isTypeObject(type)) {
    return undefined;
  }

  const filters: TableIndexFilters = {};

  for (const member of getObjectMembers(type)) {
    if (!isModelProperty(member)) {
      continue;
    }

    const value = getLiteralValue(member.value);

    if (value === undefined) {
      return undefined;
    }

    filters[member.name] = value;
  }

  return filters;
};

const getLiteralValue = (type: AllType): unknown => {
  if (isTypeScalar(type)) {
    return type.literal;
  }

  if (isTypeNull(type)) {
    return null;
  }

  if (isTypeObject(type)) {
    return getIndexFilters(type);
  }

  if (isTypeTuple(type)) {
    const values = type.elements.map((element) => getLiteralValue(element));

    return values.includes(undefined) ? undefined : values;
  }

  return undefined;
};
