import { deepEqual, equal, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Logger } from '@ez4/logger';

import { createEmulatorModule } from '../src/emulator/module';

const getModule = (name: string) => {
  return createEmulatorModule({
    entrypoint: {
      file: 'test/files/module-handlers.ts',
      position: [1, 1],
      name
    },
    variables: {},
    version: 1
  });
};

describe('project emulator module', () => {
  it('assert :: a resolved handler logs it finished', async (t) => {
    const lines: string[] = [];

    t.mock.method(Logger, 'success', (message: string) => lines.push(`success ${message}`));
    t.mock.method(Logger, 'error', (message: string) => lines.push(`error ${message}`));
    t.mock.method(Logger, 'log', () => {});

    const module = await getModule('resolveLater');

    equal(await module.invoke(), 'done');

    deepEqual(lines, ['success test/files/module-handlers.ts:1:1 [resolveLater] Finished']);
  });

  it('assert :: a rejected handler logs only that it finished with an error', async (t) => {
    const lines: string[] = [];

    t.mock.method(Logger, 'success', (message: string) => lines.push(`success ${message}`));
    t.mock.method(Logger, 'error', (message: string) => lines.push(`error ${message}`));
    t.mock.method(Logger, 'log', () => {});

    const module = await getModule('rejectLater');

    await rejects(async () => module.invoke(), { message: 'handler failed' });

    deepEqual(lines, [
      'error test/files/module-handlers.ts:1:1 [rejectLater] Error: handler failed',
      'error test/files/module-handlers.ts:1:1 [rejectLater] Finished (with error)'
    ]);
  });
});
