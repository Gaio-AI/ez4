export const enum CommandType {
  Deploy = 'deploy',
  Destroy = 'destroy',
  Output = 'output',
  Generate = 'generate',
  Run = 'run',
  Serve = 'serve',
  Test = 'test',
  Proxy = 'proxy',
  Help = 'help'
}

export type InputOptions = {
  command?: CommandType;
  branch?: string;
  project?: string;
  environment?: string;
  arguments?: string[];
  remote?: string[];
  suppress?: boolean;
  force?: boolean;
  plan?: boolean;
  inspect?: boolean;
  coverage?: boolean;
  debug?: boolean;
  reset?: boolean;
  local?: boolean;
  detach?: boolean;
  positionals?: string[];
};

export const getInputOptions = () => {
  const input = process.argv.slice(2);
  const options: InputOptions = {};

  for (let index = 0; index < input.length; index++) {
    const argument = input[index];

    if (options.command === CommandType.Proxy && !argument.startsWith('-')) {
      options.positionals = [...(options.positionals ?? []), argument];
      continue;
    }

    switch (argument) {
      case CommandType.Deploy:
      case CommandType.Destroy:
      case CommandType.Output:
      case CommandType.Generate:
      case CommandType.Run:
      case CommandType.Serve:
      case CommandType.Test:
      case CommandType.Proxy:
      case CommandType.Help:
        options.command = argument;
        break;

      case '-b':
      case '--branch':
        options.branch = input[++index];
        break;

      case '--project':
      case '-p':
        options.project = input[++index];
        break;

      case '--environment':
      case '-e':
        options.environment = input[++index];
        break;

      case '--suppress':
        options.suppress = true;
        break;

      case '--coverage':
        options.coverage = true;
        break;

      case '--inspect':
        options.inspect = true;
        break;

      case '--reset':
        options.reset = true;
        break;

      case '--debug':
        options.debug = true;
        break;

      case '--force':
        options.force = true;
        break;

      case '--plan':
        options.plan = true;
        break;

      case '--local':
        options.local = true;
        break;

      case '-d':
      case '--detach':
        options.detach = true;
        break;

      case '--remote':
        options.remote = [...(options.remote ?? []), input[++index] ?? ''];
        break;

      case '--':
        options.arguments = input.slice(index + 1);
        index = input.length;
        break;
    }
  }

  return options;
};
