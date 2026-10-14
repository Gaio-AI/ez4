// providers/aws/aws-agent/test/presets.spec.ts
import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import { PRESET_POLICIES } from '../src/role/presets';

describe('agent IAM presets and roles', () => {
  it('assert :: lambda-read preset excludes GetFunctionConfiguration and ListFunctions', () => {
    const lambdaRead = PRESET_POLICIES['lambda-read'];
    ok(lambdaRead);
    equal(lambdaRead.permissions.includes('lambda:GetFunction'), false);
    ok(lambdaRead.permissions.includes('lambda:ListAliases'));
    equal(lambdaRead.permissions.includes('lambda:GetFunctionConfiguration'), false);
    equal(lambdaRead.permissions.includes('lambda:ListFunctions'), false);
  });

  it('assert :: presets are defined for all Phase 1 presets', () => {
    ok(PRESET_POLICIES['logs-read']);
    ok(PRESET_POLICIES['logs-read'].permissions.includes('logs:StartQuery'));
    ok(PRESET_POLICIES['ecs-read']);
    ok(PRESET_POLICIES['cloudformation-read']);
  });
});
