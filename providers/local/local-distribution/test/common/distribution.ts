import type { CdnBucketOrigin, CdnRegularOrigin, CdnRewriteRule, CdnRewriteStatus, CdnService } from '@ez4/distribution/library';
import type { EmulateServiceContext, EmulatorResponse, ServeOptions, ServiceEmulator } from '@ez4/project/library';

import { CdnOriginType, compileRewritePattern, formatRewriteTarget } from '@ez4/distribution/library';

import { registerLocalService } from '../../src/provider/local';

export const options: ServeOptions = {
  prefix: 'ez4',
  projectName: 'cdn',
  branchName: '',
  serviceHost: 'localhost:3734',
  localOptions: {},
  testOptions: {},
  version: 0
};

export type RequestInput = {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
};

export const createService = (name: string, service: Partial<CdnService> & Pick<CdnService, 'defaultOrigin'>): CdnService => {
  return {
    type: '@ez4/cdn',
    context: {},
    aliases: [],
    ...service,
    name
  };
};

export const bucketOrigin = (bucket: string, origin?: Omit<Partial<CdnBucketOrigin>, 'type' | 'bucket'>): CdnBucketOrigin => {
  return {
    type: CdnOriginType.Bucket,
    ...origin,
    bucket
  };
};

export const regularOrigin = (domain: string, origin?: Omit<Partial<CdnRegularOrigin>, 'type' | 'domain'>): CdnRegularOrigin => {
  return {
    type: CdnOriginType.Regular,
    ...origin,
    domain
  };
};

/**
 * Rewrite rule as the contract metadata carries it (target formatted and pattern compiled).
 * Rules of an origin other than the default one are already prefixed with the origin base path.
 */
export const rewriteRule = (from: string, to: string, status?: CdnRewriteStatus): CdnRewriteRule => {
  return {
    ...(status && { status }),
    pattern: compileRewritePattern(from),
    to: formatRewriteTarget(to),
    from
  };
};

export const createDistribution = (service: CdnService, context: EmulateServiceContext, serveOptions = options) => {
  return registerLocalService(service, serveOptions, context);
};

export const sendRequest = async (
  emulator: ServiceEmulator,
  method: string,
  path: string,
  input?: RequestInput
): Promise<EmulatorResponse> => {
  const response = await emulator.requestHandler?.({
    headers: {
      host: options.serviceHost,
      ...input?.headers
    },
    query: input?.query ?? {},
    body: input?.body !== undefined ? Buffer.from(input.body) : undefined,
    method,
    path
  });

  if (!response) {
    throw new Error(`Distribution [${emulator.name}] didn't answer ${method} ${path}.`);
  }

  return response;
};

export const getBody = (response: EmulatorResponse) => {
  return response.body?.toString();
};
