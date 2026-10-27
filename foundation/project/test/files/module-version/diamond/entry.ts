import { fail } from './thrower.js';
import { RefusedError } from './errors.js';

export const check = () => {
  try {
    fail();
  } catch (error) {
    return error instanceof RefusedError;
  }

  return false;
};
