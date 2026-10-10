import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getStateSnapshot, prepareServicesState } from './common/plan';

// Recorded with the code before route groups: a route without a group must plan the same resources,
// hashes and bundle bytes, or adopting the version redeploys every HTTP function.
const snapshotFile = './test/files/plan-routes.json';

describe('aws gateway plan of routes without a group', () => {
  it('assert :: routes plan as before route groups', async () => {
    const state = await prepareServicesState('./test/files/plan-service.ts');
    const snapshot = await getStateSnapshot(state);

    if (!existsSync(snapshotFile)) {
      writeFileSync(snapshotFile, JSON.stringify(snapshot, undefined, 2));
    }

    deepEqual(snapshot, JSON.parse(readFileSync(snapshotFile).toString()));
  });
});
