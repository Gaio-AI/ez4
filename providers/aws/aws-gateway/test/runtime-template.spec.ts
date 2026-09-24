import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createAuthorizerFunction, createIntegrationFunction, IntegrationFunctionType } from '@ez4/aws-gateway';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createRole } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';

import { getRoleDocument } from './common/role';

const createResources = (name: string) => {
  const localState: EntryStates = {};

  const roleResource = createRole(localState, [], {
    roleName: `ez4-test-${name}-role`,
    roleDocument: getRoleDocument()
  });

  const logGroupResource = createLogGroup(localState, {
    groupName: `ez4-test-${name}-logs`,
    retention: 1
  });

  return { localState, roleResource, logGroupResource };
};

const findTemplate = (files: string[], templateFile: string) => {
  return files.find((file) => file.endsWith(join('lib', templateFile)));
};

describe('gateway functions', () => {
  const integrations = [
    [IntegrationFunctionType.HttpRequest, 'request.ts'],
    [IntegrationFunctionType.WsConnection, 'connection.ts'],
    [IntegrationFunctionType.WsMessage, 'message.ts']
  ] as const;

  for (const [type, templateFile] of integrations) {
    it(`assert :: the ${templateFile} template is hashed with the integration handler`, () => {
      const { localState, roleResource, logGroupResource } = createResources('integration-template');

      const functionResource = createIntegrationFunction(localState, roleResource, logGroupResource, {
        functionName: 'ez4-test-integration-template-lambda',
        type,
        architecture: ArchitectureType.Arm,
        runtime: RuntimeType.Node24,
        variables: [],
        memory: 128,
        timeout: 5,
        handler: {
          sourceFile: join('test/files', 'lambda.js'),
          functionName: 'main',
          dependencies: []
        }
      });

      const [, files] = functionResource.parameters.getFunctionFiles();
      const template = findTemplate(files, templateFile);

      ok(template && existsSync(template));
    });
  }

  it('assert :: the authorizer template is hashed with the authorizer handler', () => {
    const { localState, roleResource, logGroupResource } = createResources('authorizer-template');

    const functionResource = createAuthorizerFunction(localState, roleResource, logGroupResource, {
      functionName: 'ez4-test-authorizer-template-lambda',
      architecture: ArchitectureType.Arm,
      runtime: RuntimeType.Node24,
      variables: [],
      memory: 128,
      timeout: 5,
      authorizer: {
        sourceFile: join('test/files', 'lambda.js'),
        functionName: 'main',
        dependencies: []
      }
    });

    const [, files] = functionResource.parameters.getFunctionFiles();
    const template = findTemplate(files, 'authorizer.ts');

    ok(template && existsSync(template));
  });
});
