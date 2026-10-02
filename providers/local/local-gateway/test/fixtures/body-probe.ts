type BodyRequest = {
  body?: unknown;
};

export const receiveBody = (request: BodyRequest) => {
  return {
    status: 204,
    headers: {
      'x-body': JSON.stringify(request.body)
    }
  };
};

export const receiveMessage = () => {};
