import type { CdnRegularOrigin, CdnService } from '@ez4/distribution/library';
import type { ServeOptions } from '@ez4/project/library';

import { DEFAULT_VIEWER_COUNTRY, getLocalOptions } from './options';

const VIEWER_COUNTRY_HEADER = 'cloudfront-viewer-country';

// The emulator doesn't see the viewer connection, so the viewer is taken as this machine.
const LOCAL_VIEWER_ADDRESS = '127.0.0.1';

// `host` is left out by the origin request policy of the deploy (`allExcept: ['host']`), CloudFront drops or
// replaces the hop-by-hop, proxy and client address headers, and `fetch` sends the body with its own length.
const EXCLUDED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'expect',
  'content-length',
  'x-forwarded-proto',
  'x-real-ip'
]);

// Connection headers belong to the origin connection, and `fetch` already decoded the body that the
// encoding and length headers describe.
const EXCLUDED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'trailer',
  'upgrade',
  'content-encoding',
  'content-length'
]);

export const getOriginRequestHeaders = (
  service: CdnService,
  origin: CdnRegularOrigin,
  options: ServeOptions,
  viewerHeaders: Record<string, string>
) => {
  const originHeaders: Record<string, string> = {};

  for (const name in viewerHeaders) {
    if (!EXCLUDED_REQUEST_HEADERS.has(name)) {
      originHeaders[name] = viewerHeaders[name];
    }
  }

  const forwardedFor = viewerHeaders['x-forwarded-for'];

  originHeaders['x-forwarded-for'] = forwardedFor ? `${forwardedFor},${LOCAL_VIEWER_ADDRESS}` : LOCAL_VIEWER_ADDRESS;

  // CloudFront generates its own headers named in the origin cache key, replacing any the viewer sends.
  if (hasCacheHeader(origin, VIEWER_COUNTRY_HEADER)) {
    const { viewerCountry = DEFAULT_VIEWER_COUNTRY } = getLocalOptions(service, options);

    originHeaders[VIEWER_COUNTRY_HEADER] = viewerCountry;
  }

  for (const name in origin.headers) {
    originHeaders[name.toLowerCase()] = origin.headers[name];
  }

  return originHeaders;
};

export const getViewerResponseHeaders = (originHeaders: Headers) => {
  const viewerHeaders: Record<string, string> = {};

  originHeaders.forEach((value, name) => {
    if (!EXCLUDED_RESPONSE_HEADERS.has(name)) {
      viewerHeaders[name] = value;
    }
  });

  return viewerHeaders;
};

const hasCacheHeader = (origin: CdnRegularOrigin, headerName: string) => {
  return !!origin.cache?.headers?.some((name) => name.toLowerCase() === headerName);
};
