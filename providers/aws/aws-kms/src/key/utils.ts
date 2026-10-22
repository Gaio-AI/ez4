import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { EntryState } from '@ez4/state';
import type { KeyState } from './types';

import { hashData, toKebabCase } from '@ez4/utils';

import { KeyNotFoundError } from './errors';
import { KeyServiceType } from './types';

export const createKeyStateId = (identity: string) => {
  return hashData(KeyServiceType, toKebabCase(identity));
};

export const isKeyState = (resource: EntryState): resource is KeyState => {
  return resource.type === KeyServiceType;
};

export const getKeyState = (context: EventContext, serviceName: string, options: DeployOptions) => {
  const keyState = context.getServiceState(serviceName, options);

  if (!isKeyState(keyState)) {
    throw new KeyNotFoundError(serviceName);
  }

  return keyState;
};
