import type { Bucket } from '@ez4/storage';
import type { Environment } from '@ez4/common';
import type { Cdn } from '@ez4/distribution';

declare class TestBucket extends Bucket.Service {}

export declare class TestCdn extends Cdn.Service {
  defaultOrigin: Cdn.UseDefaultOrigin<{
    bucket: Environment.Service<TestBucket>;
  }>;

  // A regional web ACL can't be associated to a distribution.
  firewall: 'arn:aws:wafv2:us-east-2:000000000000:regional/webacl/test/a1b2c3d4-0000-1111-2222-333344445555';
}
