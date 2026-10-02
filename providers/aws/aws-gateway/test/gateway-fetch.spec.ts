import type { OperationLogLine } from '@ez4/aws-common';
import type { GetApisCommand, GetApisResponse } from '@aws-sdk/client-apigatewayv2';
import type { TestContext } from 'node:test';

import { describe, it } from 'node:test';
import { deepEqual, equal, rejects } from 'node:assert/strict';

import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';

import { fetchGateway } from '../src/gateway/client';

const logger: OperationLogLine = {
  update: () => {}
};

// A lookup that never ends keeps the event loop busy with resolved promises, so no test timeout fires: past this
// many calls the mock fails the test instead.
const MAX_CALLS = 10;

const mockPages = (t: TestContext, pages: GetApisResponse[]) => {
  let calls = 0;

  return t.mock.method(ApiGatewayV2Client.prototype, 'send', async (command: GetApisCommand) => {
    if (++calls > MAX_CALLS) {
      throw new Error(`GetApis was called more than ${MAX_CALLS} times.`);
    }

    const { NextToken } = command.input;

    return pages[NextToken ? Number(NextToken) : 0];
  });
};

describe('aws gateway import lookup', () => {
  it('assert :: find the api on a later page', async (t) => {
    const getApis = mockPages(t, [
      { Items: [{ Name: 'other-api', ApiId: 'other-id', ProtocolType: 'HTTP', RouteSelectionExpression: '' }], NextToken: '1' },
      {
        Items: [
          {
            Name: 'imported-api',
            ApiId: 'imported-id',
            ProtocolType: 'HTTP',
            RouteSelectionExpression: '',
            ApiEndpoint: 'https://imported'
          }
        ]
      }
    ]);

    const result = await fetchGateway(logger, 'imported-api');

    equal(result.apiId, 'imported-id');
    equal(result.endpoint, 'https://imported');

    deepEqual(
      getApis.mock.calls.map(({ arguments: [command] }) => (command as GetApisCommand).input.NextToken),
      [undefined, '1']
    );
  });

  it('assert :: fail when no page has the api', async (t) => {
    const getApis = mockPages(t, [
      { Items: [{ Name: 'other-api', ApiId: 'other-id', ProtocolType: 'HTTP', RouteSelectionExpression: '' }], NextToken: '1' },
      { Items: [{ Name: 'another-api', ApiId: 'another-id', ProtocolType: 'HTTP', RouteSelectionExpression: '' }] }
    ]);

    await rejects(fetchGateway(logger, 'imported-api'), {
      message: `API resource 'imported-api' wasn't found.`
    });

    equal(getApis.mock.callCount(), 2);
  });

  it('assert :: fail when there is no api at all', async (t) => {
    const getApis = mockPages(t, [{ Items: [] }]);

    await rejects(fetchGateway(logger, 'imported-api'), {
      message: `API resource 'imported-api' wasn't found.`
    });

    equal(getApis.mock.callCount(), 1);
  });
});
