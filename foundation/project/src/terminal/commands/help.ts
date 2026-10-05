import type { ProjectOptions } from '../../types/project';
import type { InputOptions } from '../options';

import { getGeneratorOptions } from '../../generator/options';
import { getGeneratorsUsageHelp } from '../../generator/help';
import { warnUnsupportedFlags } from '../../utils/flags';
import { loadProviders } from '../../config/providers';
import { tryLoadProject } from '../../config/project';

import { Logger, LogFormat } from '@ez4/logger';

const HELP_LINES = [
  LogFormat.toBold('Usage:'),
  '  ez4 [command] [options] [ -p ez4.project.js ] [ -- arguments ]',
  '',
  LogFormat.toBold('Commands:'),
  '  deploy    Create and publish all resources for the given project',
  '  destroy   Remove all resources from the last deploy for the given project',
  '  output    Display the last deploy output for the given project',
  '  generate  Execute a generator action for the given project',
  '  run       Execute script files for the given project',
  '  serve     Emulate all resources for the given project',
  '  test      Run test suites for the given project',
  '  proxy     Route <name>.localhost to local processes (run, ls, stop, setup)',
  '  help      Display the command line options',
  '',
  LogFormat.toBold('Options:'),
  '  --                 Specify test patterns, scripts to run, or generator arguments',
  '  --branch, -b       Specify the name for resource branch deployment or destruction',
  '  --project, -p      Specify the project configuration file (Default is ez4.project.js)',
  '  --environment, -e  Specify the environment variables file to load',
  '  --remote <VAR>     With proxy run: route VAR (a domain or URL) through <VAR>.<name>.localhost with localhost CORS',
  '  --suppress         Suppress local resource emulation when serving',
  '  --coverage         Enable code coverage reports when testing',
  '  --inspect          Enable inspect mode when serving, running, or testing',
  '  --reset            Reset local resources when serving, running, or testing',
  '  --debug            Enable debug mode for all provider resources',
  '  --force            Force deployment or destruction of resources',
  '  --plan             Show the deployment or destruction plan and exit without applying it (exit code 2 when it has changes)',
  '  --local            Use local options when serving or testing',
  '  --detach, -d       Run in background when using proxy run',
  '',
  LogFormat.toBold('Proxy:'),
  '  ez4 proxy run [-d] <name> [--remote VAR]... -- <command>  Serve <command> at http://<name>.localhost with PORT and HOST set',
  '  ez4 proxy ls                                              List the running routes',
  '  ez4 proxy stop <name>                                     Stop the process behind a route',
  '  ez4 proxy setup                                           Allow port 80 without root on Linux (system-wide sysctl, sudo)',
  '  proxy run targets POSIX shells (Linux, macOS); killing its wrapper with SIGKILL orphans the command.',
  ''
];

export const helpCommand = async (input: InputOptions) => {
  const project = await tryLoadProject(input.project);

  HELP_LINES.forEach((line) => Logger.log(line));

  await generatorsHelp(input, project);

  if (warnUnsupportedFlags(input)) {
    Logger.space();
  }
};

const generatorsHelp = async (input: InputOptions, project: ProjectOptions) => {
  await loadProviders(project);

  const options = getGeneratorOptions(input, project);
  const helps = getGeneratorsUsageHelp(options);

  const helpLines = [];

  for (const { arguments: inputs, description } of helps) {
    const helpEntries = [];

    for (let index = 0; index < inputs.length; ++index) {
      const maxLength = Math.max(...helps.map((help) => help.arguments[index]?.length ?? -1));
      const helpEntry = inputs[index].padEnd(maxLength);

      helpEntries.push(helpEntry);
    }

    if (helpEntries.length) {
      helpLines.push(`  ${helpEntries.join(' ')} - ${description}`);
    }
  }

  if (helpLines.length) {
    Logger.log(LogFormat.toBold('Generators:'));
    helpLines.forEach((line) => Logger.log(line));
    Logger.space();
  }
};
