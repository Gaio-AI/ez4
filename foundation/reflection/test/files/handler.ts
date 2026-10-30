import type { AnyObject } from '@ez4/utils';
import type { Shared } from './shared';
import type { Redirected } from './redirected';

export const handler = (shared: Shared, redirected: Redirected, context: AnyObject) => {
  return [shared, redirected, context];
};
