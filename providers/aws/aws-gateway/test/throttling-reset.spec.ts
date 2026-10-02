import type { OperationLogLine } from '@ez4/aws-common';

import { afterEach, describe, it, mock } from 'node:test';
import { deepEqual, equal, rejects } from 'node:assert/strict';

import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';

import { ThrottlingResetError } from '../src/stage/errors';
import { resetThrottling } from '../src/stage/client';

const logger: OperationLogLine = {
  update: () => {}
};

const mockAccount = (getAccount: () => Promise<unknown>) => {
  mock.method(APIGatewayClient.prototype, 'send', getAccount);

  return mock.method(ApiGatewayV2Client.prototype, 'send', async () => ({}));
};

describe('gateway stage throttling reset', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: reset to the account limits', async () => {
    const updateStage = mockAccount(async () => ({ throttleSettings: { rateLimit: 10000, burstLimit: 5000 } }));

    await resetThrottling(logger, 'api-id', '$default');

    equal(updateStage.mock.callCount(), 1);

    const [command] = updateStage.mock.calls[0].arguments;

    deepEqual(command?.input, {
      ApiId: 'api-id',
      StageName: '$default',
      DefaultRouteSettings: {
        ThrottlingRateLimit: 10000,
        ThrottlingBurstLimit: 5000
      }
    });
  });

  it('assert :: fail when the account limits cannot be read', async () => {
    const updateStage = mockAccount(async () => {
      throw new Error('not authorized to perform: apigateway:GET');
    });

    await rejects(resetThrottling(logger, 'api-id', '$default'), (error) => {
      return error instanceof ThrottlingResetError && error.message.includes('not authorized to perform: apigateway:GET');
    });

    equal(updateStage.mock.callCount(), 0);
  });

  it('assert :: never write a zero limit', async () => {
    const updateStage = mockAccount(async () => ({ throttleSettings: { rateLimit: 0, burstLimit: 0 } }));

    await rejects(resetThrottling(logger, 'api-id', '$default'), ThrottlingResetError);

    equal(updateStage.mock.callCount(), 0);
  });

  it('assert :: fail when the account returns no limits', async () => {
    const updateStage = mockAccount(async () => ({}));

    await rejects(resetThrottling(logger, 'api-id', '$default'), ThrottlingResetError);

    equal(updateStage.mock.callCount(), 0);
  });
});
