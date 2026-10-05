import type { ParserOptions } from '@readme/openapi-parser';

import { buildMetadata } from '@ez4/project/library';
import { compileErrors, validate } from '@readme/openapi-parser';

import { equal, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parse } from 'yaml';

import { getGatewayServices } from '../src/utils/service';
import { OpenApiGenerator } from '../src/generator/oas';

type ValidationRules = NonNullable<NonNullable<ParserOptions['validate']>['rules']>['openapi'];

const testFile = async (fileName: string, rules?: ValidationRules) => {
  const sourceFile = `./test/input/output-${fileName}.ts`;

  const { metadata } = buildMetadata([sourceFile]);
  const apis = getGatewayServices(metadata);

  equal(apis.length, 1);

  // Parsing fails on malformed YAML and on duplicate keys.
  const document = parse(OpenApiGenerator.getGatewayOutput(apis[0]));

  // Validates against the official OpenAPI 3.1 schema, resolves every $ref and checks the rules a JSON schema
  // can't express, such as unique operation ids and declared path parameters.
  const result = await validate(document, {
    validate: {
      rules: {
        openapi: rules
      }
    }
  });

  ok(result.valid, compileErrors(result));
};

// The empty api stays out: OpenAPI accepts its empty paths, but the validator requires at least one entry.
describe('gateway documentation (open api validation)', () => {
  it('assert :: post route', () => testFile('post'));
  it('assert :: get route', () => testFile('get'));
  it('assert :: patch route', () => testFile('patch'));
  it('assert :: put route', () => testFile('put'));
  it('assert :: delete route', () => testFile('delete'));
  it('assert :: operation', () => testFile('operation'));
  it('assert :: auth header', () => testFile('auth-header'));
  it('assert :: auth query', () => testFile('auth-query'));
  it('assert :: auth jwt', () => testFile('auth-jwt'));
  it('assert :: complete api', () => testFile('complete'));
  it('assert :: naming style in arrays', () => testFile('naming-array'));
  it('assert :: nullable fields', () => testFile('nullable'));
  it('assert :: response headers', () => testFile('headers'));
  it('assert :: handler errors', () => testFile('throws'));

  // Both routes share the handler and have no name, so their operation id is the same.
  it('assert :: naming style', () => testFile('naming-style', { 'duplicate-operation-id': 'warning' }));
});
