import type { FunctionState } from '@ez4/aws-function';
import type { EntryStates } from '@ez4/state';

import { equal, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { prepareServicesState } from './common/plan';

const getFunction = (state: EntryStates, functionName: string) => {
  const functionState = Object.values(state).find((entry) => {
    return entry?.type === 'aws:lambda.function' && (entry as FunctionState).parameters.functionName === functionName;
  });

  ok(functionState);

  return functionState as FunctionState;
};

describe('aws gateway plan of reserved concurrency', () => {
  it('assert :: the route and group functions take their reservation', async () => {
    const state = await prepareServicesState('./test/files/plan-reserved-concurrency.ts');

    equal(getFunction(state, 'ez4-plan-test-items-service-create-item').parameters.reservedConcurrency, 5);
    equal(getFunction(state, 'ez4-plan-test-items-service-group-items').parameters.reservedConcurrency, 2);
  });

  it('assert :: a function without a reservation plans none', async () => {
    const state = await prepareServicesState('./test/files/plan-reserved-concurrency.ts');

    const { parameters } = getFunction(state, 'ez4-plan-test-items-service-health');

    // As the state file keeps it: an existing function's plan doesn't change.
    ok(!('reservedConcurrency' in JSON.parse(JSON.stringify(parameters))));
  });
});
