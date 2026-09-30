import type { Environment } from '@ez4/common';
import type { Cdn } from '@ez4/distribution';
import type { Bucket } from '@ez4/storage';

/**
 * Site files.
 */
export declare class ProjectBucket extends Bucket.Service {}

/**
 * Static site distribution with a single page app fallback.
 */
export declare class ProjectCdn extends Cdn.Service {
  defaultIndex: 'index.html';

  aliases: ['site.ez4.dev'];

  certificate: Cdn.UseCertificate<{
    domain: 'site.ez4.dev';
  }>;

  defaultOrigin: Cdn.UseDefaultOrigin<{
    bucket: Environment.Service<ProjectBucket>;
  }>;

  fallbacks: [
    Cdn.UseFallback<{
      location: '/index.html';
      code: 404;
    }>
  ];
}
