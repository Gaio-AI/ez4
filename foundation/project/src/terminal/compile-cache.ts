import type { InputOptions } from './options';

import { join } from 'node:path';

import { CommandType } from './options';

/**
 * Directory of the compile cache for a CLI run, or `undefined` for a run without it.
 *
 * The cache keeps one entry per module URL. `ez4 serve` loads the whole graph again under a new `?v=` on every
 * reload, so a session would add entries without end; it runs without the cache, even one a variable asks for.
 * Coverage needs every module compiled from source. The cache lives in the checkout's `node_modules`, next to
 * the code it compiles, rather than in the system's temporary directory.
 */
export const getCompileCacheDirectory = (input: InputOptions, env: NodeJS.ProcessEnv, workingDirectory: string) => {
  if (input.command === CommandType.Serve || input.coverage || env.NODE_V8_COVERAGE) {
    return undefined;
  }

  return join(workingDirectory, 'node_modules', '.cache', 'ez4');
};
