import { describe, it, before, after } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFile = promisify(execFileCallback);

type VpcConfig = {
  SubnetIds: string[];
  SecurityGroupIds: string[];
};

type DeployReport = {
  action?: string;
  // The plan lists every deployed entry as an update; the preview is what tells whether it changes.
  changes?: {
    create?: Record<string, unknown>;
    nested?: Record<string, unknown>;
  } | null;
  result?: {
    vpcConfig?: {
      subnetIds: string[];
      securityGroupIds: string[];
    };
  };
  errors: string[];
  commands: { name: string; vpcConfig?: VpcConfig }[];
};

const FunctionsTag = { 'ez4:functions': 'true' };

const UntaggedNetwork = {
  vpcId: 'vpc-default',
  subnets: [
    { id: 'subnet-public-b' },
    { id: 'subnet-public-a' },
    { id: 'subnet-public-c' },
    { id: 'subnet-private-b' },
    { id: 'subnet-private-a' }
  ],
  securityGroups: [
    { id: 'sg-default', name: 'default' },
    { id: 'sg-functions', name: 'functions' }
  ]
};

const TaggedNetwork = {
  ...UntaggedNetwork,
  subnets: [
    { id: 'subnet-public-b' },
    { id: 'subnet-public-a' },
    { id: 'subnet-public-c' },
    { id: 'subnet-private-b', tags: FunctionsTag },
    { id: 'subnet-private-a', tags: FunctionsTag }
  ],
  securityGroups: [
    { id: 'sg-default', name: 'default' },
    { id: 'sg-functions', name: 'functions', tags: FunctionsTag }
  ]
};

/**
 * A function in a VPC runs in the subnets and security groups of the default VPC tagged
 * `ez4:functions=true`, or in its first two subnets and default security group when none is tagged.
 * The network can change between deploys (subnets added and tagged), so the state keeps the configuration
 * in use, the plan reports when the network moved, and the function is reconfigured.
 *
 * Each deploy runs in a process of its own (see `common/deploy-vpc.ts`) with Lambda and EC2 answered in
 * place, so a reconfiguration is a recorded `UpdateFunctionConfigurationCommand` and its VPC settings.
 */
describe('function vpc', { timeout: 120000 }, () => {
  const deployScript = fileURLToPath(new URL('./common/deploy-vpc.ts', import.meta.url));

  let projectPath: string;
  let stateFile: string;

  const deployProject = async (network: typeof UntaggedNetwork, vpc = true): Promise<DeployReport> => {
    const networkFile = join(projectPath, 'network.json');
    const reportFile = join(projectPath, 'report.json');

    await writeFile(networkFile, JSON.stringify(network));

    await execFile(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', deployScript, stateFile, networkFile, `${vpc}`, reportFile],
      {
        cwd: projectPath,
        env: {
          ...process.env,
          // Lambda and EC2 never leave the process, and anything else that tried would find nothing here.
          AWS_ENDPOINT_URL: 'http://127.0.0.1:9',
          AWS_ACCESS_KEY_ID: 'local',
          AWS_SECRET_ACCESS_KEY: 'local',
          AWS_REGION: 'us-east-1'
        }
      }
    );

    const report: DeployReport = JSON.parse(await readFile(reportFile, 'utf8'));

    deepEqual(report.errors, []);

    return report;
  };

  const getVpcCommand = (report: DeployReport, name: string) => {
    return report.commands.find((command) => command.name === name)?.vpcConfig;
  };

  before(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'ez4-function-vpc-'));
    stateFile = join(projectPath, 'state.json');

    await writeFile(join(projectPath, 'handler.js'), 'export const main = () => {};');
  });

  after(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('assert :: without tagged resources, the first two subnets and the default security group', async () => {
    const report = await deployProject(UntaggedNetwork);

    equal(report.action, 'create');

    deepEqual(getVpcCommand(report, 'CreateFunctionCommand'), {
      SubnetIds: ['subnet-public-b', 'subnet-public-a'],
      SecurityGroupIds: ['sg-default']
    });

    deepEqual(report.result?.vpcConfig, {
      subnetIds: ['subnet-public-b', 'subnet-public-a'],
      securityGroupIds: ['sg-default']
    });
  });

  it('assert :: tagged subnets and security groups move the function', async () => {
    const report = await deployProject(TaggedNetwork);

    ok(report.changes?.nested?.vpcConfig);

    deepEqual(getVpcCommand(report, 'UpdateFunctionConfigurationCommand'), {
      SubnetIds: ['subnet-private-a', 'subnet-private-b'],
      SecurityGroupIds: ['sg-functions']
    });

    deepEqual(report.result?.vpcConfig, {
      subnetIds: ['subnet-private-a', 'subnet-private-b'],
      securityGroupIds: ['sg-functions']
    });
  });

  it('assert :: the same network is no change', async () => {
    const report = await deployProject(TaggedNetwork);

    ok(!report.changes);
    deepEqual(report.commands, []);
  });

  it('assert :: a state without the configuration in use gets it once', async () => {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));

    for (const entry of Object.values<{ result?: { vpcConfig?: unknown } }>(state)) {
      delete entry.result?.vpcConfig;
    }

    await writeFile(stateFile, JSON.stringify(state));

    const report = await deployProject(TaggedNetwork);

    ok(report.changes?.create?.vpcConfig);

    deepEqual(report.result?.vpcConfig, {
      subnetIds: ['subnet-private-a', 'subnet-private-b'],
      securityGroupIds: ['sg-functions']
    });
  });

  it('assert :: leaving the vpc clears the configuration', async () => {
    const report = await deployProject(TaggedNetwork, false);

    ok(report.changes);

    deepEqual(getVpcCommand(report, 'UpdateFunctionConfigurationCommand'), {
      SubnetIds: [],
      SecurityGroupIds: []
    });

    equal(report.result?.vpcConfig, undefined);
  });
});
