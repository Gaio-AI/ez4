import type { Bucket } from '@ez4/storage';

export declare class TestStorage extends Bucket.Service {
  cacheControl: [
    Bucket.UseCacheRule<{
      path: '*';
      value: 'no-cache';

      // No extra property is allowed.
      invalid_property: true;
    }>
  ];
}
