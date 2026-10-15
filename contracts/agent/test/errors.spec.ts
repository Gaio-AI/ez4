import { deepEqual, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IncompleteServiceError, InvalidCpuMemoryCombinationError, UnknownPresetError } from '@ez4/agent/library';
import { parseFile } from './common/parser';

describe('agent metadata errors', () => {
  it('assert :: incomplete agent', () => {
    const [error] = parseFile('incomplete-service', 1);
    ok(error instanceof IncompleteServiceError);
  });

  it('assert :: invalid optional agent members report agent and member', () => {
    const errors = parseFile('invalid-optional-members', 6);
    deepEqual(
      errors.map((error) => {
        ok(error instanceof IncompleteServiceError);
        return error.properties;
      }),
      [
        ['InvalidTools.tools'],
        ['InvalidMcpServers.mcpServers'],
        ['InvalidImage.image'],
        ['InvalidEgress.egress'],
        ['InvalidSecrets.secrets'],
        ['InvalidStatements.permissions.statements']
      ]
    );
  });

  it('assert :: invalid cpu/memory combo', () => {
    const [error] = parseFile('invalid-resources', 1);
    ok(error instanceof InvalidCpuMemoryCombinationError);
  });

  it('assert :: unknown preset', () => {
    const [error] = parseFile('invalid-preset', 1);
    ok(error instanceof UnknownPresetError);
  });
});
