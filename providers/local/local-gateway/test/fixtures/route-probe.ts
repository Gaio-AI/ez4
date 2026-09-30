type RouteRequest = {
  parameters?: Record<string, string>;
};

const getRouteResponse = (route: string, request: RouteRequest) => {
  return {
    status: 204,
    headers: {
      'x-route': route,
      'x-parameters': JSON.stringify(request.parameters ?? {})
    }
  };
};

export const anyProxyRoute = (request: RouteRequest) => getRouteResponse('ANY /{proxy+}', request);

export const petsProxyRoute = (request: RouteRequest) => getRouteResponse('GET /pets/{proxy+}', request);

export const dogRoute = (request: RouteRequest) => getRouteResponse('GET /pets/dog/{id}', request);

export const firstDogRoute = (request: RouteRequest) => getRouteResponse('GET /pets/dog/1', request);

export const anyItemRoute = (request: RouteRequest) => getRouteResponse('ANY /items/{itemId}', request);

export const getItemRoute = (request: RouteRequest) => getRouteResponse('GET /items/{id}', request);
