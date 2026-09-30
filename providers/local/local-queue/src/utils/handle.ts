import type { AnyObject } from '@ez4/utils';

import { isAnyObject } from '@ez4/utils';

export type LocalQueueHandle = {
  getDeadLetterMessages: () => AnyObject[];
  waitForDrain: () => Promise<void>;
};

// A registered symbol, the same one in the emulator bundle that attaches the handle to its clients and in
// the tester bundle that reads it.
export const LocalQueueHandleKey: unique symbol = Symbol.for('@ez4/local-queue:handle');

export const getLocalQueueHandle = (client: unknown): LocalQueueHandle | undefined => {
  if (!isAnyObject(client)) {
    return undefined;
  }

  return (client as { [LocalQueueHandleKey]?: LocalQueueHandle })[LocalQueueHandleKey];
};
