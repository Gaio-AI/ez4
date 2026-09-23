import type { Arn } from '@ez4/aws-common';

import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { getAccessLogChange, getAccessLogFormat } from '../src/stage/helpers/access-log';

const LOG_GROUP: Arn = 'arn:aws:logs:us-east-1:000000000000:log-group:ez4-test-gateway';
const OTHER_LOG_GROUP: Arn = 'arn:aws:logs:us-east-1:000000000000:log-group:ez4-test-other';

describe('gateway stage access log', () => {
  const format = getAccessLogFormat();

  it('assert :: enable on a stage that gets a log group', () => {
    deepEqual(getAccessLogChange({ logGroupArn: LOG_GROUP, format }, {}), {
      action: 'enable',
      logGroupArn: LOG_GROUP
    });
  });

  it('assert :: leave a stage whose log group and format are unchanged', () => {
    equal(getAccessLogChange({ logGroupArn: LOG_GROUP, format }, { logGroupArn: LOG_GROUP, format }), undefined);
  });

  it('assert :: rewrite the format of a stage that already logs', () => {
    deepEqual(getAccessLogChange({ logGroupArn: LOG_GROUP, format }, { logGroupArn: LOG_GROUP, format: '{}' }), {
      action: 'enable',
      logGroupArn: LOG_GROUP
    });

    // A stage deployed by a version that did not keep the format in its parameters.
    deepEqual(getAccessLogChange({ logGroupArn: LOG_GROUP, format }, { logGroupArn: LOG_GROUP }), {
      action: 'enable',
      logGroupArn: LOG_GROUP
    });
  });

  it('assert :: move the log to a new log group', () => {
    deepEqual(getAccessLogChange({ logGroupArn: OTHER_LOG_GROUP, format }, { logGroupArn: LOG_GROUP, format }), {
      action: 'enable',
      logGroupArn: OTHER_LOG_GROUP
    });
  });

  it('assert :: disable on a stage that lost its log group', () => {
    deepEqual(getAccessLogChange({}, { logGroupArn: LOG_GROUP, format }), { action: 'disable' });
    deepEqual(getAccessLogChange({}, { logGroupArn: LOG_GROUP }), { action: 'disable' });
  });

  it('assert :: leave a stage that never logged', () => {
    equal(getAccessLogChange({}, {}), undefined);
  });

  it('assert :: log what tells a gateway failure apart', () => {
    const line = JSON.parse(format);

    equal(line.responseLatency, '$context.responseLatency');
    equal(line.errorType, '$context.error.responseType');
    equal(line.integrationServiceStatus, '$context.integration.integrationStatus');
    equal(line.integrationLatency, '$context.integration.latency');
    equal(line.authorizationError, '$context.authorizer.error');
  });
});
