import { DatabaseErrorException } from '@aws-sdk/client-rds-data';

// The Data API appends the SQLState after the server message, which can echo input values, so the last one is the error's own.
const SQL_STATE_PATTERN = /SQLState: ([0-9A-Z]{5})\b/g;

const getSqlState = (error: DatabaseErrorException) => {
  const matches = [...error.message.matchAll(SQL_STATE_PATTERN)];

  return matches.at(-1)?.[1];
};

export const isAuthenticationException = (error: unknown) => {
  return error instanceof DatabaseErrorException && getSqlState(error) === '28P01';
};

export const isDuplicateUniqueKeyException = (error: unknown) => {
  return error instanceof DatabaseErrorException && getSqlState(error) === '23505';
};

export const isDeadlockException = (error: unknown) => {
  return error instanceof DatabaseErrorException && getSqlState(error) === '40P01';
};
