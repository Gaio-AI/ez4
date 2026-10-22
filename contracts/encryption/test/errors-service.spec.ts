import { ok, deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import { InvalidServicePropertyError } from '@ez4/common/library';
import { IncompleteServiceError, registerTriggers } from '@ez4/encryption/library';

import { parseFile } from './common/parser';

describe('encryption service metadata errors', () => {
  registerTriggers();

  it('assert :: incomplete encryption import', () => {
    const [error1] = parseFile('incomplete-import', 1);

    ok(error1 instanceof IncompleteServiceError);
    deepEqual(error1.properties, ['project']);
  });

  it('assert :: invalid encryption property', () => {
    const [error1] = parseFile('invalid-service-property', 1);

    ok(error1 instanceof InvalidServicePropertyError);
    deepEqual(error1.propertyName, 'invalid_property');
  });
});
