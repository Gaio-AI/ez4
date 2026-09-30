import type { EmulatorRequestEvent } from '@ez4/project/library';
import type { HttpCors } from '@ez4/gateway/library';

export const isPreflightRequest = (request: EmulatorRequestEvent) => {
  const { method, headers } = request;

  return method === 'OPTIONS' && !!headers.origin && !!headers['access-control-request-method'];
};

// The CORS headers API Gateway sends for the configuration: none unless the origin is allowed, and for a preflight,
// unless its method and headers are allowed too.
export const getCorsHeaders = (cors: HttpCors, request: EmulatorRequestEvent) => {
  const { origin, ['access-control-request-method']: requestMethod, ['access-control-request-headers']: requestHeaders } = request.headers;

  const headers: Record<string, string> = {};

  if (!origin || !isOriginAllowed(cors.allowOrigins, origin)) {
    return headers;
  }

  headers['access-control-allow-origin'] = cors.allowOrigins.includes('*') ? '*' : origin;

  if (!isPreflightRequest(request)) {
    if (cors.allowCredentials) {
      headers['access-control-allow-credentials'] = 'true';
    }

    if (cors.exposeHeaders?.length) {
      headers['access-control-expose-headers'] = cors.exposeHeaders.join(',');
    }

    return headers;
  }

  if (!isMethodAllowed(cors.allowMethods, requestMethod) || !areHeadersAllowed(cors.allowHeaders, requestHeaders)) {
    return {};
  }

  headers['access-control-allow-methods'] = cors.allowMethods?.join(',') ?? '';
  headers['access-control-allow-headers'] = cors.allowHeaders?.join(',') ?? '';

  if (cors.allowCredentials) {
    headers['access-control-allow-credentials'] = 'true';
  }

  if (cors.maxAge !== undefined) {
    headers['access-control-max-age'] = `${cors.maxAge}`;
  }

  return headers;
};

const isOriginAllowed = (allowOrigins: string[], origin: string) => {
  return allowOrigins.some((allowOrigin) => {
    // Besides `*`, API Gateway takes a scheme wildcard, such as `https://*`.
    if (allowOrigin.endsWith('://*')) {
      return origin.startsWith(allowOrigin.slice(0, -1));
    }

    return allowOrigin === '*' || allowOrigin === origin;
  });
};

const isMethodAllowed = (allowMethods: string[] | undefined, method: string) => {
  const requestMethod = method.toUpperCase();

  return !!allowMethods?.some((allowMethod) => allowMethod === '*' || allowMethod.toUpperCase() === requestMethod);
};

const areHeadersAllowed = (allowHeaders: string[] | undefined, headers: string | undefined) => {
  const allowedHeaders = new Set(allowHeaders?.map((header) => header.toLowerCase()));

  if (!headers || allowedHeaders.has('*')) {
    return true;
  }

  return headers
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .every((header) => !header || allowedHeaders.has(header));
};
