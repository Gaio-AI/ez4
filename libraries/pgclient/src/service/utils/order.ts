// Tail of the statements queued on each open transaction.
const TRANSACTION_QUEUES = new Map<string, Promise<void>>();

/**
 * Run the operation once every operation queued before it on the same transaction has finished. A rollback to a
 * savepoint undoes every statement the transaction ran after the savepoint, so a statement sent by a concurrent call
 * must not land between an upsert's savepoint and its release. Without a transaction the operation runs at once.
 */
export const runInTransactionOrder = async <T>(transactionId: string | undefined, operation: () => Promise<T>) => {
  if (!transactionId) {
    return operation();
  }

  const previous = TRANSACTION_QUEUES.get(transactionId);

  const { promise: finished, resolve: finish } = Promise.withResolvers<void>();

  const tail = previous ? previous.then(() => finished) : finished;

  TRANSACTION_QUEUES.set(transactionId, tail);

  try {
    await previous;

    return await operation();
  } finally {
    finish();

    if (TRANSACTION_QUEUES.get(transactionId) === tail) {
      TRANSACTION_QUEUES.delete(transactionId);
    }
  }
};
