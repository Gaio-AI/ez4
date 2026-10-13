import type { HttpRoute, HttpService } from '@ez4/gateway/library';
import { getPropertyName, isReferenceSchema, type NamingStyle, type ObjectSchema } from '@ez4/schema';
import { isDocumentedRequired } from '@ez4/schema/library';

import { isAnyArray, isEmptyObject } from '@ez4/utils';

import { getIndentedOutput, getMultilineOutput, getNameOutput } from '../utils/format';
import { getSchemaReference } from '../utils/reference';
import { getRouteErrors } from './errors';
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

  const summary = handler.summary ?? getFirstSentence(handler.comment);
  const description = handler.description ?? handler.comment;

  if (summary) {
    output.push(`summary: "${getMultilineOutput(summary)}"`);
  }

  // A comment of one sentence is all summary.
  if (description && getSingleLine(description) !== summary) {
    output.push(`description: "${getMultilineOutput(description)}"`);
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

    // The parameter carries the description, so its schema doesn't repeat it.
    const description = isReferenceSchema(propertySchema) ? undefined : propertySchema.description;
    const valueSchema = isReferenceSchema(propertySchema) ? propertySchema : { ...propertySchema, description: undefined };

    // A header, path or query value arrives as a string and is never null, so a nullable parameter is
    // documented by its type alone, and the gateway refuses it missing unless it's optional. One the
    // handler refuses missing itself is documented as required (`@required`).
    const isRequired = !propertySchema.optional || isDocumentedRequired(propertySchema);
    const schemaOutput = getSchemaOutput({ ...valueSchema, nullable: false }, namingStyle);

    const parameterOutput = [`in: ${target}`];

    if (description) {
      parameterOutput.push(`description: "${getMultilineOutput(description)}"`);
    }

    output.push(`- name: ${propertyName}`, ...getIndentedOutput([...parameterOutput, `required: ${isRequired}`, ...schemaOutput]));
  }

  return output;
};

const getSingleLine = (text: string) => {
  return text.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
};

/**
 * The first sentence of a handler's JSDoc, on one line and without its period, as the operation's
 * summary.
 */
const getFirstSentence = (text?: string) => {
  const [paragraph = ''] = text?.split(/\n\s*\n/) ?? [];
  const [sentence = ''] = paragraph
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s/);

  return getSingleLine(sentence) || undefined;
};

const getHeadersOutput = (schema: ObjectSchema) => {
  const output = [];

  for (const headerName in schema.properties) {
    const headerSchema = schema.properties[headerName];

    // A header has no null value, so a nullable header is one that may be missing, like an optional one.
    const isRequired = !(headerSchema.nullable || headerSchema.optional);
    const schemaOutput = getSchemaOutput({ ...headerSchema, nullable: false });

    output.push(`${getNameOutput(headerName)}:`, ...getIndentedOutput([`required: ${isRequired}`, ...schemaOutput]));
  }

  if (!output.length) {
    return [];
  }

  return ['headers:', ...getIndentedOutput(output)];
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

    if (response.headers) {
      content.push(...getHeadersOutput(response.headers));
    }

    if (response.body) {
      content.push(...getContentOutput([getResponseSchemaName(handler)]));
    }

    output.push(`'${status}':`, ...getIndentedOutput(content));
  }

  for (const { status, description, schemaNames } of getRouteErrors(service, route)) {
    if (statuses.includes(status)) {
      continue;
    }

    const content = [`description: "${getMultilineOutput(description)}"`, ...getContentOutput(schemaNames)];

    output.push(`'${status}':`, ...getIndentedOutput(content));
  }

  return output;
};
