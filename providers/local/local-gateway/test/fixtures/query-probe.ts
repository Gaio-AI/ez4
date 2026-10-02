type QueryRequest = {
  query?: unknown;
};

export const receiveQuery = (request: QueryRequest) => {
  return {
    status: 204,
    headers: {
      'x-query': JSON.stringify(request.query ?? null)
    }
  };
};

export const authorizeQuery = () => {
  return {
    identity: {
      id: 'probe'
    }
  };
};
