import { describe, it } from 'node:test';
import { equal } from 'node:assert/strict';

import { getServiceBranch } from '../src/utils/resource';

describe('service branch', () => {
  it('assert :: separators become dashes instead of vanishing', () => {
    equal(getServiceBranch('feat/inbox-search'), 'feat-inbox-search');
    equal(getServiceBranch('Feat_X.Y'), 'feat-x-y');
  });

  it('assert :: an absent branch stays empty', () => {
    equal(getServiceBranch(undefined), '');
    equal(getServiceBranch(''), '');
  });
});
