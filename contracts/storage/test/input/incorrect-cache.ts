import type { Bucket } from '@ez4/storage';

export declare class TestStorage extends Bucket.Service {
  cacheControl: [TestCacheRule];
}

// Missing Bucket.CacheRule inheritance.
declare class TestCacheRule {
  path: '*';
  value: 'no-cache';
}
