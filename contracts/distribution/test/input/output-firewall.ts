import type { Bucket } from '@ez4/storage';
import type { Environment } from '@ez4/common';
import type { Cdn } from '@ez4/distribution';

declare class TestBucket extends Bucket.Service {}

export declare class TestCdn extends Cdn.Service {
  defaultOrigin: Cdn.UseDefaultOrigin<{
    bucket: Environment.Service<TestBucket>;
  }>;

  // Web ACL from the environment.
  firewall: Environment.Variable<'TEST_FIREWALL_ARN'>;
}

export declare class TestLiteralCdn extends Cdn.Service {
  defaultOrigin: Cdn.UseDefaultOrigin<{
    bucket: Environment.Service<TestBucket>;
  }>;

  // Web ACL as a literal.
  firewall: 'arn:aws:wafv2:us-east-1:000000000000:global/webacl/test-literal/a1b2c3d4-0000-1111-2222-333344445555';
}
