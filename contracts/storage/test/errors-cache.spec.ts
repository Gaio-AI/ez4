import { ok, equal, deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import { IncompleteCacheRuleError, IncorrectCacheRuleTypeError } from '@ez4/storage/library';
import { InvalidServicePropertyError } from '@ez4/common/library';
import { registerTriggers } from '@ez4/storage/library';

import { parseFile } from './common/parser';

describe('storage cache rule metadata errors', () => {
  registerTriggers();

  it('assert :: incomplete cache rule', () => {
    const [error1] = parseFile('incomplete-cache', 1);

    ok(error1 instanceof IncompleteCacheRuleError);
    deepEqual(error1.properties, ['value']);
  });

  it('assert :: incorrect cache rule', () => {
    const [error1] = parseFile('incorrect-cache', 1);

    ok(error1 instanceof IncorrectCacheRuleTypeError);
    equal(error1.baseType, 'Bucket.CacheRule');
    equal(error1.modelType, 'TestCacheRule');
  });

  it('assert :: invalid cache rule (property)', () => {
    const [error1] = parseFile('invalid-cache-property', 1);

    ok(error1 instanceof InvalidServicePropertyError);
    equal(error1.propertyName, 'invalid_property');
  });
});
