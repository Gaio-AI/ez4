import type { EmulatorRequestEvent, EmulatorResponse, ServeOptions } from '@ez4/project/library';
import type { CdnRegularOrigin, CdnService } from '@ez4/distribution/library';

import { OriginProtocol } from '@ez4/distribution';
import { Logger } from '@ez4/logger';

import { getOriginRequestHeaders, getViewerResponseHeaders } from '../utils/headers';
import { getOriginErrorResponse } from '../utils/response';
import { getOriginPath } from '../utils/behavior';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

export const sendRegularRequest = async (
  service: CdnService,
  origin: CdnRegularOrigin,
  options: ServeOptions,
  request: EmulatorRequestEvent
): Promise<EmulatorResponse> => {
  const { method, headers, body } = request;

  const originUrl = getOriginUrl(origin, options, request);

  try {
    const response = await fetch(originUrl, {
      ...(body && method !== 'GET' && method !== 'HEAD' && { body: new Uint8Array(body) }),
      headers: getOriginRequestHeaders(service, origin, options, headers),
      redirect: 'manual',
      method
    });

    const responseBody = Buffer.from(await response.arrayBuffer());

    return {
      status: response.status,
      headers: getViewerResponseHeaders(response.headers),
      ...(responseBody.length > 0 && {
        body: responseBody
      })
    };
  } catch (error) {
    Logger.warn(`Distribution [${service.name}] can't reach ${originUrl}: ${getErrorCause(error)}`);

    return getOriginErrorResponse();
  }
};

const getOriginUrl = (origin: CdnRegularOrigin, options: ServeOptions, request: EmulatorRequestEvent) => {
  // Servers on this machine, the ez4 serve included, answer plain HTTP whatever the deployed protocol.
  const isHttp = isLocalHost(origin.domain, options) || origin.protocol === OriginProtocol.Http;

  const originUrl = new URL(`${isHttp ? 'http' : 'https'}://${origin.domain}`);

  if (origin.port) {
    originUrl.port = `${origin.port}`;
  }

  originUrl.pathname = `${getOriginPath(origin)}${request.path}`;
  originUrl.search = new URLSearchParams(request.query).toString();

  return originUrl;
};

const isLocalHost = (domain: string, options: ServeOptions) => {
  const hostname = getHostname(domain);

  return LOCAL_HOSTNAMES.has(hostname) || hostname === getHostname(options.serviceHost);
};

const getHostname = (host: string) => {
  return new URL(`http://${host}`).hostname;
};

const getErrorCause = (error: unknown) => {
  if (error instanceof Error && error.cause instanceof Error) {
    return error.cause.message;
  }

  return `${error}`;
};
