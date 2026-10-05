import type { AllType, ReflectionTypes, TypeCallback, TypeFunction, TypeModel } from '@ez4/reflection';
import type { Incomplete } from '@ez4/utils';
import type { HttpHandler, HttpHandlerError } from './types';

import { getFunctionReferences, getFunctionSignature, isFunctionSignature } from '@ez4/common/library';
import { isTypeCallback, isTypeFunction } from '@ez4/reflection';
import { isObjectWith } from '@ez4/utils';

import { IncompleteHandlerError } from '../../errors/handler';
import { getWebProviderMetadata } from '../provider';
import { getHttpResponseMetadata } from './response';
import { getHttpRequestMetadata } from './request';
import { HttpNamespaceType } from './types';

export const isHttpHandlerDeclaration = (type: AllType): type is TypeCallback | TypeFunction => {
  return isTypeCallback(type) || isTypeFunction(type);
};

export const getHttpHandlerMetadata = (
  type: AllType,
  parent: TypeModel,
  reflection: ReflectionTypes,
  errorList: Error[],
  external: boolean
) => {
  if (!isHttpHandlerDeclaration(type)) {
    return undefined;
  }

  const handler: Incomplete<HttpHandler> = {
    ...getFunctionSignature(type),
    ...getHandlerDocumentation(type)
  };

  const properties = new Set(['response']);

  if (type.parameters) {
    const [requestType, contextType] = type.parameters;

    if (requestType) {
      handler.request = getHttpRequestMetadata(requestType.value, parent, reflection, errorList);
    }

    if (contextType) {
      const references = getFunctionReferences(contextType);

      if (references) {
        handler.references = references;
      }

      if (!external) {
        handler.provider = getWebProviderMetadata(contextType.value, parent, reflection, errorList, HttpNamespaceType);
        handler.isolated = true;
      }
    }
  }

  if (type.return && (handler.response = getHttpResponseMetadata(type.return, parent, reflection, errorList))) {
    properties.delete('response');
  }

  if (!isCompleteHandler(handler)) {
    errorList.push(new IncompleteHandlerError([...properties], type.file));
    return undefined;
  }

  return handler;
};

const getHandlerDocumentation = (type: TypeCallback | TypeFunction) => {
  const deprecated = type.tags?.some(({ name }) => name === 'deprecated');
  const errors = [];
  const tags = [];

  for (const { name, text } of type.tags ?? []) {
    const value = text?.trim();

    if (name === 'tag' && value) {
      tags.push(value);
    }

    if (name === 'throws' && value) {
      const error = getHandlerError(value);

      if (error) {
        errors.push(error);
      }
    }
  }

  return {
    ...(deprecated && { deprecated }),
    ...(tags.length && { tags }),
    ...(errors.length && { errors })
  };
};

/**
 * Read a `@throws <status> [description]` tag. Any other `@throws`, such as one naming an error class,
 * documents the function and not the route.
 */
const getHandlerError = (text: string): HttpHandlerError | undefined => {
  const match = text.match(/^([45]\d{2})(?:\s+(.+))?$/s);

  if (!match) {
    return undefined;
  }

  const [, status, description] = match;

  return {
    status: Number(status),
    ...(description && { description })
  };
};

const isCompleteHandler = (type: Incomplete<HttpHandler>): type is HttpHandler => {
  return isObjectWith(type, ['response']) && isFunctionSignature(type);
};
