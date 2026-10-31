import { DatabaseErrorException } from '@aws-sdk/client-rds-data';

// The Data API appends the SQLState after the server message, which can echo input values, so the last one is the error's own.
const SQL_STATE_PATTERN = /SQLState: ([0-9A-Z]{5})\b/g;

// A direct connection's error carries the SQLState as its code.
const getSqlState = (error: unknown) => {
  if (error instanceof DatabaseErrorException) {
    const matches = [...error.message.matchAll(SQL_STATE_PATTERN)];

    return matches.at(-1)?.[1];
  }

  const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;

  return typeof code === 'string' ? code : undefined;
};

export const isAuthenticationException = (error: unknown) => {
  return getSqlState(error) === '28P01';
};

export const isDuplicateUniqueKeyException = (error: unknown) => {
  return getSqlState(error) === '23505';
};

export const isDeadlockException = (error: unknown) => {
  return getSqlState(error) === '40P01';
};

export const isLockTimeoutException = (error: unknown) => {
  return getSqlState(error) === '55P03';
};
