import type { CdnOrigin, CdnRewriteStatus, CdnService } from '@ez4/distribution/library';
import type { EmulatorRequestEvent, EmulatorResponse, ServeOptions } from '@ez4/project/library';

const REDIRECT_TARGET = /^https?:\/\//;

export type ViewerRewrite = {
  status?: CdnRewriteStatus;
  target: string;
};

export const getViewerRewrite = (service: CdnService, origin: CdnOrigin, path: string): ViewerRewrite | undefined => {
  // The deploy puts the rules of every origin in one viewer function, associated with the cache
  // behavior of each origin that has rules of its own.
  if (!origin.rewrite?.length) {
    return undefined;
  }

  const allRules = [service.defaultOrigin, ...(service.origins ?? [])].flatMap(({ rewrite }) => rewrite ?? []);

  for (const { pattern, status, to } of allRules) {
    const variables = new RegExp(pattern).exec(path);

    if (variables) {
      return {
        target: applyTargetVariables(to, variables),
        status
      };
    }
  }

  return undefined;
};

export const isRedirectRewrite = (rewrite: ViewerRewrite) => {
  return !!rewrite.status || REDIRECT_TARGET.test(rewrite.target);
};

export const getRedirectResponse = (
  rewrite: ViewerRewrite,
  request: EmulatorRequestEvent,
  options: ServeOptions,
  identifier: string
): EmulatorResponse => {
  const { status = 302, target } = rewrite;

  // A relative target points back to the distribution, which is served over plain HTTP under its identifier.
  const location = REDIRECT_TARGET.test(target) ? target : `http://${request.headers.host ?? options.serviceHost}/${identifier}${target}`;
  const query = getQueryString(request.query);

  return {
    status,
    headers: {
      location: query ? `${location}?${query}` : location
    }
  };
};

// The deployed viewer function only resolves references made of `0` and `1` digits.
const applyTargetVariables = (target: string, variables: RegExpExecArray) => {
  return target.replaceAll(/\$([0-1]+)/g, (_, index: string) => `${variables[Number(index)]}`);
};

const getQueryString = (query: Record<string, string>) => {
  return Object.entries(query)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
};
