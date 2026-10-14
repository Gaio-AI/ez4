import { ok } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IncompleteServiceError, InvalidCpuMemoryCombinationError, UnknownPresetError } from '@ez4/agent/library';
import { parseFile } from './common/parser';

describe('agent metadata errors', () => {
  it('assert :: incomplete agent', () => {
    const [error] = parseFile('incomplete-service', 1);
    ok(error instanceof IncompleteServiceError);
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
