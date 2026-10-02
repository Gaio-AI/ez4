import { ok, equal } from 'assert/strict';
import { describe, it } from 'node:test';

import { InvalidFirewallError, registerTriggers } from '@ez4/distribution/library';

import { parseFile } from './common/parser';

describe('distribution firewall metadata errors', () => {
  registerTriggers();

  it('assert :: invalid firewall (value)', () => {
    const [error] = parseFile('invalid-firewall-value', 1);

    ok(error instanceof InvalidFirewallError);
    equal(error.firewall, 'arn:aws:wafv2:us-east-2:000000000000:regional/webacl/test/a1b2c3d4-0000-1111-2222-333344445555');
  });

  it('assert :: invalid firewall (unresolved variable)', () => {
    const [error] = parseFile('invalid-firewall-variable', 1);

    ok(error instanceof InvalidFirewallError);
    equal(error.firewall, undefined);
  });
});
