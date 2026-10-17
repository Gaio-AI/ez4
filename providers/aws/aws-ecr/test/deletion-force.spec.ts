import type { StepContext } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { getEcrRepositoryHandler } from '../src/repository/handler';

const makeContext = () => {
  const warnings: string[] = [];

  const context = { force: false, addWarning: (message: string) => warnings.push(message) } as unknown as StepContext;

  return { context, warnings };
};

describe('ecr :: deletion needs --force', () => {
  it('keeps the repository, and its images, and says so', async () => {
    const { context, warnings } = makeContext();

    await getEcrRepositoryHandler().delete(
      {
        type: 'aws:ecr.repository',
        entryId: 'r',
        dependencies: [],
        parameters: { repositoryName: 'stg-agents/implement-agent' },
        result: { repositoryArn: 'arn', repositoryUri: 'uri' }
      } as never,
      context
    );

    deepEqual(warnings, ["ECR repository 'stg-agents/implement-agent' was kept; deleting it needs --force."]);
  });
});
