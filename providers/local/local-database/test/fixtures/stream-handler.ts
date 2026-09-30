import type { Service } from '@ez4/common';
import type { Database } from '@ez4/database';

import { Runtime } from '@ez4/common';

export type ItemSchema = {
  id: string;
  order?: number;
  value?: number;
  email?: string;
  expiresAt?: number;
};

export type StreamRequest = Database.Incoming<ItemSchema>;

export type ObservedChange = {
  request: StreamRequest;
  scope: Runtime.Scope | undefined;
  context: unknown;
};

export type ObservedEvent = {
  type: string;
  request: Partial<StreamRequest>;
};

declare global {
  var observeChange: ((observed: ObservedChange) => Promise<void> | void) | undefined;
  var observeEvent: ((observed: ObservedEvent) => void) | undefined;
}

export const streamHandler = async (request: StreamRequest, context: unknown) => {
  await globalThis.observeChange?.({
    scope: Runtime.getScope(),
    request,
    context
  });
};

export const streamListener = (event: Service.AnyEvent<StreamRequest>) => {
  globalThis.observeEvent?.({
    type: event.type,
    request: event.request
  });
};
