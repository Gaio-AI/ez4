import type { HttpRoute, HttpService } from '@ez4/gateway/library';
import { getPropertyName, type NamingStyle, type ObjectSchema } from '@ez4/schema';

import { isAnyArray, isEmptyObject } from '@ez4/utils';

import { getIndentedOutput, getMultilineOutput, getNameOutput } from '../utils/format';
import { getSchemaReference } from '../utils/reference';
import { getErrorDescription, getRouteErrors } from './errors';
import { getResponseSchemaName } from './response';
import { getRequestSchemaName } from './request';
import { getSecuritySchemes } from './security';
import { getSchemaOutput } from './schema';

export const getServiceRoutesOutput = (service: HttpService) => {
  const output: Record<string, string[]> = {};

  const defaultPreferences = service.defaults?.preferences;

  for (const route of service.routes) {
    const [verb, path] = route.path.split(' ', 2);

    const namingStyle = route.preferences?.namingStyle ?? defaultPreferences?.namingStyle;

    if (!output[path]) {
      output[path] = [];
    }

    output[path].push(`${verb.toLowerCase()}:`, ...getIndentedOutput(getRouteOutput(service, route, namingStyle)));
  }

  if (isEmptyObject(output)) {
    return ['paths: {}', ''];
  }

  return ['paths:', ...getIndentedOutput(Object.entries(output).flatMap(([path, lines]) => [`${path}:`, ...getIndentedOutput(lines)])), ''];
};

const getRouteOutput = (service: HttpService, route: HttpRoute, namingStyle?: NamingStyle) => {
  const output = [];

  const { name, authorizer, handler } = route;
  const { request } = handler;

  output.push(`operationId: ${getNameOutput(name ?? handler.name)}`);

  if (handler.summary) {
    output.push(`summary: "${getMultilineOutput(handler.summary)}"`);
  }

  if (handler.description) {
    output.push(`description: "${getMultilineOutput(handler.description)}"`);
  }

  if (handler.tags?.length) {
    output.push('tags:', ...getIndentedOutput(handler.tags.map((tag) => `- "${getMultilineOutput(tag)}"`)));
  }

  if (handler.deprecated) {
    output.push('deprecated: true');
  }

  if (authorizer) {
    output.push(...getSecurityRequirementOutput(Object.keys(getSecuritySchemes(authorizer))));
  }

  if (request) {
    const parameters = [];

    if (request.headers) {
      parameters.push(...getParametersOutput('header', request.headers));
    }

    if (request.parameters) {
      parameters.push(...getParametersOutput('path', request.parameters));
    }

    if (request.query) {
      parameters.push(...getParametersOutput('query', request.query, namingStyle));
    }

    if (parameters.length) {
      output.push('parameters:', ...getIndentedOutput(parameters));
    }

    if (request.body) {
      output.push('requestBody:', ...getIndentedOutput(getContentOutput([getRequestSchemaName(handler)])));
    }
  }

  output.push('responses:', ...getIndentedOutput(getResponsesOutput(service, route)));

  return output;
};

const getSecurityRequirementOutput = (schemeNames: string[]) => {
  if (!schemeNames.length) {
    return [];
  }

  // A single requirement with all the schemes, since the request needs all of them.
  const [firstScheme, ...otherSchemes] = schemeNames.map((schemeName) => `${getNameOutput(schemeName)}: []`);

  return ['security:', ...getIndentedOutput([`- ${firstScheme}`, ...getIndentedOutput(otherSchemes)])];
};

const getParametersOutput = (target: string, schema: ObjectSchema, namingStyle?: NamingStyle) => {
  const output = [];

  for (const propertyKey in schema.properties) {
    const propertySchema = schema.properties[propertyKey];
    const propertyName = getNameOutput(getPropertyName(propertyKey, namingStyle));

    const isRequired = !(propertySchema.nullable || propertySchema.optional);
    const schemaOutput = getSchemaOutput(propertySchema, namingStyle);

    output.push(`- name: ${propertyName}`, ...getIndentedOutput([`in: ${target}`, `required: ${isRequired}`, ...schemaOutput]));
  }

  return output;
};

const getContentOutput = (schemaNames: string[]) => {
  const schemaOutput =
    schemaNames.length > 1
      ? ['anyOf:', ...getIndentedOutput(schemaNames.map((schemaName) => `- $ref: '${getSchemaReference(schemaName)}'`))]
      : schemaNames.map((schemaName) => `$ref: '${getSchemaReference(schemaName)}'`);

  return ['content:', ...getIndentedOutput(['application/json:', ...getIndentedOutput(['schema:', ...getIndentedOutput(schemaOutput)])])];
};

const getResponsesOutput = (service: HttpService, route: HttpRoute) => {
  const { handler } = route;
  const { response } = handler;

  const statuses = isAnyArray(response.status) ? response.status : [response.status];

  const output = [];

  for (const status of statuses) {
    const content = [`description: "Successful response."`];

    if (response.body) {
      content.push(...getContentOutput([getResponseSchemaName(handler)]));
    }

    output.push(`'${status}':`, ...getIndentedOutput(content));
  }

  for (const [status, schemaNames] of getRouteErrors(service, route)) {
    if (statuses.includes(status)) {
      continue;
    }

    const content = [`description: "${getMultilineOutput(getErrorDescription(status))}"`, ...getContentOutput(schemaNames)];

    output.push(`'${status}':`, ...getIndentedOutput(content));
  }

  return output;
};
