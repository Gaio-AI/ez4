import type { ModelProperty } from '@ez4/reflection';

import { getPropertyNumber } from '@ez4/common/library';
import { isAnyNumber } from '@ez4/utils';

import { InvalidReservedConcurrencyError } from '../../errors/http/route';

/**
 * Reserved concurrency of a route or group function, which must be a positive integer.
 */
export const getReservedConcurrency = (member: ModelProperty, errorList: Error[], fileName?: string) => {
  const value = getPropertyNumber(member);

  if (!isAnyNumber(value)) {
    return undefined;
  }

  // A reservation of zero stops the function: every request to it would fail.
  if (!Number.isInteger(value) || value <= 0) {
    errorList.push(new InvalidReservedConcurrencyError(value, fileName));
    return undefined;
  }

  return value;
};
