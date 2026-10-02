import type { PgClientDriver } from '../types/driver';

// The error that made the transaction fail stays the one the caller throws: a rollback failure is attached
// to it as `rollbackError`, not as `cause`, which means what led to the error and is read to describe it.
export const rollbackFailedTransaction = async (driver: PgClientDriver, transactionId: string, error: unknown) => {
  try {
    await driver.rollbackTransaction(transactionId);
  } catch (rollbackError) {
    if (error instanceof Error) {
      // Unlike an assignment, it doesn't throw on a frozen error, so attaching never replaces the error.
      Reflect.set(error, 'rollbackError', rollbackError);
    }
  }
};
