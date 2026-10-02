import type { ServeOptions } from '@ez4/project/library';

import { describe, it } from 'node:test';
import { throws } from 'node:assert/strict';

import { registerRemoteService } from '../src/provider/remote';
import { getImportOptions, getQueueImport } from './queue';

describe('local queue disabled import', () => {
  it('assert :: a queue import of a disabled project fails', () => {
    const options = getImportOptions('localhost:0');

    const disabledOptions = {
      ...options,
      imports: {
        owner: {
          ...options.imports!.owner!,
          disabled: true
        }
      }
    } as ServeOptions;

    throws(() => registerRemoteService(getQueueImport('disabledImport'), disabledOptions), {
      message: `Import disabledImport of owner can't be disabled, only Http.Import supports a disabled project reference.`
    });
  });
});
