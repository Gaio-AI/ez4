import type { EntryState, StepState } from '@ez4/state';
import type { DeployOptions } from '../src/types/options';

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { doesNotReject, match } from 'node:assert/strict';

import { tryCreateTrigger } from '@ez4/project/library';
import { StepAction } from '@ez4/state';

import { reportResourceChanges } from '../src/deploy/changes';

const migrationEntry = (repository: Record<string, unknown>): EntryState => ({
  type: 'test:migration',
  entryId: 'migration',
  dependencies: [],
  parameters: { repository }
});

const oldState = { migration: migrationEntry({ old_table: { name: 'old_table', indexes: { id: { name: 'id' } } } }) };
const newState = { migration: migrationEntry({ new_table: { name: 'new_table', indexes: { id: { name: 'id' } } } }) };

const renamedTable: StepState = {
  action: StepAction.Update,
  entryId: 'migration',
  order: 0,
  preview: {
    counts: 1,
    name: 'database',
    nested: {
      repository: {
        counts: 2,
        rename: { old_table: 'new_table' },
        nested: {
          new_table: {
            counts: 1,
            update: { name: 'new_table' }
          }
        }
      }
    }
  } as StepState['preview']
};

tryCreateTrigger('Test:report-rename', {
  'deploy:plan': () => [renamedTable]
});

describe('report :: renamed nested resource', () => {
  const log = mock.method(console, 'log', () => {});
  const group = mock.method(console, 'group', () => {});

  beforeEach(() => {
    log.mock.resetCalls();
    group.mock.resetCalls();
  });

  afterEach(() => {
    log.mock.resetCalls();
  });

  it('assert :: reports a renamed table against its previous name', async () => {
    await doesNotReject(reportResourceChanges(newState, oldState, { force: false } as DeployOptions));

    const output = log.mock.calls.map((call) => String(call.arguments[0])).join('\n');

    match(output, /old_table/);
    match(output, /new_table/);
  });
});
