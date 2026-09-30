import type { EmulateServiceContext, EmulatorRequestEvent, EmulatorResponse, ServeOptions } from '@ez4/project/library';
import type { CdnService } from '@ez4/distribution/library';

import { getServiceName } from '@ez4/project/library';

import { getRedirectResponse, getViewerRewrite, isRedirectRewrite } from '../utils/rewrite';
import { getDefaultIndexPath, getRequestOrigin } from '../utils/behavior';
import { getDisabledResponse } from '../utils/response';
import { sendOriginRequest } from './origin';
import { applyFallback } from './fallback';

export const processDistributionRequest = async (
  service: CdnService,
  options: ServeOptions,
  context: EmulateServiceContext,
  request: EmulatorRequestEvent
): Promise<EmulatorResponse> => {
  if (service.disabled) {
    return getDisabledResponse();
  }

  // The cache behavior comes from the viewer path and stays the same after the viewer function rewrites it.
  const origin = getRequestOrigin(service, request.path);
  const rewrite = getViewerRewrite(service, origin, request.path);

  if (rewrite && isRedirectRewrite(rewrite)) {
    return getRedirectResponse(rewrite, request, options, getServiceName(service, options));
  }

  const response = await sendOriginRequest(service, origin, options, context, {
    ...request,
    path: getDefaultIndexPath(service, rewrite?.target ?? request.path)
  });

  return applyFallback(service, options, context, request, response);
};
