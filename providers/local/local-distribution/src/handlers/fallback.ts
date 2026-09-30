import type { EmulateServiceContext, EmulatorRequestEvent, EmulatorResponse, ServeOptions } from '@ez4/project/library';
import type { CdnService } from '@ez4/distribution/library';

import { formatUri } from '@ez4/distribution/library';

import { getRequestOrigin } from '../utils/behavior';
import { sendOriginRequest } from './origin';

export const applyFallback = async (
  service: CdnService,
  options: ServeOptions,
  context: EmulateServiceContext,
  request: EmulatorRequestEvent,
  response: EmulatorResponse
): Promise<EmulatorResponse> => {
  const fallback = service.fallbacks?.find(({ code }) => code === response.status);

  if (!fallback) {
    return response;
  }

  // CloudFront gets the error page from the origin whose path pattern matches the page location.
  const location = formatUri(fallback.location);
  const origin = getRequestOrigin(service, location);

  const fallbackResponse = await sendOriginRequest(service, origin, options, context, {
    headers: request.headers,
    method: 'GET',
    path: location,
    query: {}
  });

  // An error page that can't be served leaves the viewer with the original error.
  if (fallbackResponse.status < 200 || fallbackResponse.status > 299) {
    return response;
  }

  // The deploy answers every fallback with `ResponseCode: '200'`.
  return {
    ...fallbackResponse,
    status: 200
  };
};
