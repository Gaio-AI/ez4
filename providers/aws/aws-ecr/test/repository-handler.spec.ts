import type { StepOptions } from '@ez4/state';
import type { EcrRepositoryState } from '../src/repository/types';
import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import { createEcrRepository, createEcrRepositoryStateId } from '../src/repository/service';
import { getEcrRepositoryHandler } from '../src/repository/handler';
import { EcrRepositoryServiceType } from '../src/repository/types';

describe('ECR repository step handler', () => {
  it('assert :: creates repository state entry with correct parameters and ID', () => {
    const states: Record<string, EcrRepositoryState> = {};

    const state = createEcrRepository(states, {
      repositoryName: 'test-agent-repo',
      imageTagMutability: 'IMMUTABLE',
      scanOnPush: true
    });

    equal(state.type, EcrRepositoryServiceType);
    equal(state.parameters.repositoryName, 'test-agent-repo');
    equal(state.parameters.imageTagMutability, 'IMMUTABLE');
    equal(state.parameters.scanOnPush, true);
    equal(state.entryId, createEcrRepositoryStateId('test-agent-repo'));
    ok(states[state.entryId] !== undefined);
  });

  it('assert :: handler equals compares repositoryArn', () => {
    const handler = getEcrRepositoryHandler();

    const candidate: EcrRepositoryState = {
      type: EcrRepositoryServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: { repositoryName: 'test-repo' },
      result: {
        repositoryName: 'test-repo',
        repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/test-repo',
        repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/test-repo'
      }
    };

    const currentSame: EcrRepositoryState = {
      ...candidate
    };

    const currentDiff: EcrRepositoryState = {
      ...candidate,
      result: {
        ...candidate.result!,
        repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/other-repo'
      }
    };

    ok(handler.equals(candidate, currentSame));
    ok(!handler.equals(candidate, currentDiff));
  });

  it('assert :: handler preview detects parameter changes', async () => {
    const handler = getEcrRepositoryHandler();
    const options = {} as StepOptions;
    const candidate: EcrRepositoryState = {
      type: EcrRepositoryServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: {
        repositoryName: 'test-repo',
        scanOnPush: true
      }
    };

    const currentSame: EcrRepositoryState = {
      ...candidate
    };

    const currentDiff: EcrRepositoryState = {
      type: EcrRepositoryServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: {
        repositoryName: 'test-repo',
        scanOnPush: false
      }
    };

    equal(await handler.preview(candidate, currentSame, options), undefined);

    const changes = await handler.preview(candidate, currentDiff, options);
    ok(changes !== undefined);
    equal(changes.counts, 1);
  });
});
