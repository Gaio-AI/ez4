import type { EmulateServiceContext, EmulatorRequestEvent, EmulatorResponse, ServeOptions } from '@ez4/project/library';
import type { CdnOrigin, CdnService } from '@ez4/distribution/library';

import { isCdnBucketOrigin } from '@ez4/distribution/library';

import { sendRegularRequest } from './regular';
import { sendBucketRequest } from './bucket';

export const sendOriginRequest = (
  service: CdnService,
  origin: CdnOrigin,
  options: ServeOptions,
  context: EmulateServiceContext,
  request: EmulatorRequestEvent
): Promise<EmulatorResponse> => {
  if (isCdnBucketOrigin(origin)) {
    return sendBucketRequest(origin, context, request);
  }

  return sendRegularRequest(service, origin, options, request);
};
