import type { OperationLogLine } from '@ez4/aws-common';
import type { TestContext } from 'node:test';

import { describe, it } from 'node:test';
import { equal } from 'node:assert/strict';

import { LambdaClient, UpdateFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { LogLevel } from '@ez4/project';

import { updateConfiguration } from '../src/function/client';

const logger = { update: () => {} } as unknown as OperationLogLine;

/**
 * The system log level a configuration update sends, with the Lambda API mocked.
 */
const getSystemLogLevel = async (t: TestContext, systemLogLevel?: LogLevel) => {
  let input: UpdateFunctionConfigurationCommand['input'] | undefined;

  t.mock.method(LambdaClient.prototype, 'send', async (command: unknown) => {
    if (command instanceof UpdateFunctionConfigurationCommand) {
      input = command.input;
    }

    // What the waiter polls for.
    return {
      State: 'Active',
      LastUpdateStatus: 'Successful'
    };
  });

  await updateConfiguration(logger, 'ez4-test-system-log-level', {
    logLevel: LogLevel.Error,
    systemLogLevel
  });

  return input?.LoggingConfig?.SystemLogLevel;
};

describe('function system log level', () => {
  it('assert :: platform lines keep warning by default', async (t) => {
    equal(await getSystemLogLevel(t), 'WARN');
  });

  it('assert :: platform lines follow the system log level', async (t) => {
    equal(await getSystemLogLevel(t, LogLevel.Information), 'INFO');
    equal(await getSystemLogLevel(t, LogLevel.Debug), 'DEBUG');
    equal(await getSystemLogLevel(t, LogLevel.Warning), 'WARN');
  });

  it('assert :: platform lines have no error level', async (t) => {
    equal(await getSystemLogLevel(t, LogLevel.Error), 'WARN');
  });
});
