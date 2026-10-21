const fail = () => {
  throw new Error('Dependency is down.');
};

export const defaultHandler = fail;

export const twoAttemptsHandler = fail;

export const oneAttemptHandler = fail;

export const backoffHandler = fail;
