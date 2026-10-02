import type { DatabaseService } from '@ez4/database/library';
import type { CommonOptions } from '@ez4/project/library';

import { describe, it } from 'node:test';
import { equal, notEqual, ok } from 'node:assert/strict';

import { getDatabaseName } from '@ez4/pgclient/utils';

const service = { name: 'db' } as DatabaseService;

const options = (branchName: string) => ({ prefix: 'dev', projectName: 'console', branchName }) as CommonOptions;

describe('database name', () => {
  it('assert :: a short name is unchanged', () => {
    equal(getDatabaseName(service, options('worktree-local-urls')), 'console_db_worktree_local_urls');
  });

  it('assert :: a long name fits postgres and stays unique', () => {
    const first = getDatabaseName(service, options(`${'a'.repeat(70)}-one`));
    const second = getDatabaseName(service, options(`${'a'.repeat(70)}-two`));

    ok(first.length <= 63);
    ok(second.length <= 63);
    notEqual(first, second);
  });
});
