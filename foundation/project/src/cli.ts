#!/usr/bin/env node
import * as module from 'node:module';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { Logger } from '@ez4/logger';

import { CommandType, getInputOptions } from './terminal/options';
import { proxyCommand } from './terminal/commands/proxy';
import { checkMinNodeVersion } from './terminal/version';

checkMinNodeVersion();

const applicationPath = join(import.meta.dirname, './application.mjs');
const extensionsPath = join(import.meta.dirname, './extensions.mjs');

const input = getInputOptions();

// The application process reads the directory from `NODE_COMPILE_CACHE` and caches what it compiles there.
// Coverage needs every module compiled from source, so it runs without the cache.
const setupCompileCache = () => {
  if (input.coverage || process.env.NODE_V8_COVERAGE) {
    process.env.NODE_DISABLE_COMPILE_CACHE = '1';
    return;
  }

  const cache = module.enableCompileCache();

  if (cache.directory) {
    process.env.NODE_COMPILE_CACHE = cache.directory;
  }
};

const runApplication = () => {
  if (input.project) {
    process.env.EZ4_PROJECT_FILE = input.project;
  }

  setupCompileCache();

  const extraArguments = [];

  if (input.command === CommandType.Test) {
    extraArguments.push('--experimental-test-module-mocks');

    if (input.coverage) {
      extraArguments.push('--experimental-test-coverage');
    }
  }

  if (input.command === CommandType.Serve || input.command === CommandType.Test || input.command === CommandType.Run) {
    extraArguments.push('--enable-source-maps');

    if (input.inspect) {
      extraArguments.push('--inspect');
    }
  }

  const childProcess = spawn(
    'node',
    [
      // Invocation options
      '--no-warnings',
      '--experimental-strip-types',
      '--experimental-transform-types',

      // Extra arguments
      ...extraArguments,

      // Custom resolution hooks
      '--import',
      extensionsPath,

      // Forward invocation
      applicationPath,
      ...process.argv.slice(2)
    ],
    {
      stdio: 'inherit'
    }
  );

  const setupShutdown = () => {
    childProcess.removeAllListeners('exit');
    childProcess.once('exit', () => process.exit(childProcess.exitCode));
  };

  process.on('SIGTERM', setupShutdown);
  process.on('SIGINT', setupShutdown);

  setupShutdown();
};

if (input.command === CommandType.Proxy) {
  try {
    await proxyCommand(input);
  } catch (error) {
    Logger.error((error as Error).message);
    process.exit(1);
  }
} else {
  runApplication();
}
