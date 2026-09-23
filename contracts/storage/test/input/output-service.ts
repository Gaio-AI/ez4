import type { Environment } from '@ez4/common';
import type { Bucket } from '@ez4/storage';

/**
 * Internal storage description.
 *
 * @description Test storage service.
 */
export declare class TestStorage extends Bucket.Service {
  globalName: 'global-bucket-name';

  localPath: './public';

  autoExpireDays: 30;

  staleExpireDays: 7;

  cacheControl: [
    Bucket.UseCacheRule<{
      path: 'assets/*';
      value: 'public, max-age=31536000, immutable';
    }>,
    {
      path: '*';
      value: 'no-cache';
    }
  ];

  variables: {
    TEST_VAR1: 'test-literal-value';
    TEST_VAR2: Environment.Variable<'TEST_ENV_VAR'>;
  };
}
