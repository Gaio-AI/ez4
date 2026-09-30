import type { CdnOrigin, CdnService } from '@ez4/distribution/library';

import { formatUri } from '@ez4/distribution/library';

const ESCAPED_PATTERN = /[.+^${}()|[\]\\]/g;

export const getRequestOrigin = (service: CdnService, path: string): CdnOrigin => {
  const origin = service.origins?.find((origin) => {
    return !!origin.path && isPathPatternMatch(origin.path, path);
  });

  return origin ?? service.defaultOrigin;
};

export const getOriginPath = (origin: CdnOrigin) => {
  if (!origin.location) {
    return '';
  }

  return formatUri(origin.location);
};

export const getDefaultIndexPath = (service: CdnService, path: string) => {
  // CloudFront serves the default root object for the distribution root only.
  if (path === '/' && service.defaultIndex) {
    return `/${service.defaultIndex}`;
  }

  return path;
};

const isPathPatternMatch = (pattern: string, path: string) => {
  // Cache behavior patterns are case-sensitive, imply a leading `/`, and their `*` matches any
  // characters (`/` included) while `?` matches exactly one.
  const expression = formatUri(pattern).replaceAll(ESCAPED_PATTERN, '\\$&').replaceAll('*', '.*').replaceAll('?', '.');

  return new RegExp(`^${expression}$`).test(path);
};
