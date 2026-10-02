import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { getThrottlingChange } from '../src/stage/helpers/throttling';

describe('gateway stage throttling change', () => {
  it('assert :: apply on a stage that gets throttling', () => {
    deepEqual(getThrottlingChange({ rateLimit: 10, burstLimit: 5 }, undefined), {
      action: 'apply',
      throttling: { rateLimit: 10, burstLimit: 5 }
    });
  });

  it('assert :: apply new limits', () => {
    deepEqual(getThrottlingChange({ rateLimit: 10, burstLimit: 5 }, { rateLimit: 10, burstLimit: 2 }), {
      action: 'apply',
      throttling: { rateLimit: 10, burstLimit: 5 }
    });

    deepEqual(getThrottlingChange({ rateLimit: 20, burstLimit: 5 }, { rateLimit: 10, burstLimit: 5 }), {
      action: 'apply',
      throttling: { rateLimit: 20, burstLimit: 5 }
    });
  });

  it('assert :: leave a stage whose limits are unchanged', () => {
    equal(getThrottlingChange({ rateLimit: 10, burstLimit: 5 }, { rateLimit: 10, burstLimit: 5 }), undefined);
  });

  it('assert :: reset a stage that lost its throttling', () => {
    deepEqual(getThrottlingChange(undefined, { rateLimit: 10, burstLimit: 5 }), { action: 'reset' });
  });

  it('assert :: leave a stage that never had throttling', () => {
    equal(getThrottlingChange(undefined, undefined), undefined);
  });
});
