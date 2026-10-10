import type { DeployOptions, EventContext, ServiceMetadata } from '@ez4/project/library';
import type { HttpService } from '@ez4/gateway/library';
import type { EntryState, EntryStates, StepContext } from '@ez4/state';
import type { FunctionState } from '@ez4/aws-function';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';

import { buildMetadata, getServiceState, setServiceState, triggerAllAsync, tryGetServiceState } from '@ez4/project/library';
import { registerTriggers as registerGatewayTriggers, isHttpService } from '@ez4/gateway/library';
import { registerTriggers } from '@ez4/aws-gateway';
import { createRole } from '@ez4/aws-identity';

import { getRoleDocument } from './role';

export const planOptions: DeployOptions = {
  prefix: 'ez4',
  projectName: 'plan-test',
  branchName: '',
  lockId: 'ez4-plan-test',
  release: {
    version: '1.0.0'
  },
  defaults: {
    memory: 256
  },
  variables: {
    PROJECT_NAME: 'plan-test'
  },
  tags: {
    Project: 'plan-test'
  }
};

const getEventContext = (role: EntryState, dependencies: Record<string, string[]>): EventContext => {
  const regular = {};
  const virtual = {};

  return {
    role,
    setServiceState: (service: ServiceMetadata | string, options: DeployOptions, state: EntryState) => {
      setServiceState(regular, state, service, options);
    },
    getServiceState: (service: ServiceMetadata | string, options: DeployOptions) => {
      return getServiceState(regular, service, options);
    },
    setVirtualServiceState: (service: ServiceMetadata | string, options: DeployOptions, state: EntryState) => {
      setServiceState(virtual, state, service, options);
    },
    getVirtualServiceState: (service: ServiceMetadata | string, options: DeployOptions) => {
      return tryGetServiceState(virtual, service, options);
    },
    getDependencyFiles: (fileName: string) => {
      return dependencies[fileName] ?? [];
    }
  };
};

/**
 * The state a deploy prepares for the HTTP services of the given file, before any plan or apply.
 */
export const prepareServicesState = async (
  sourceFile: string,
  options = planOptions,
  beforeConnect?: (services: HttpService[]) => void
) => {
  registerGatewayTriggers();
  registerTriggers();

  const { metadata, dependencies } = buildMetadata([sourceFile]);

  const services = Object.values(metadata).filter((service) => isHttpService(service));

  const state: EntryStates = {};

  const role = createRole(state, [], {
    roleName: 'ez4-plan-test-role',
    roleDocument: getRoleDocument()
  });

  const context = getEventContext(role, dependencies);

  // The same events, in the same order, a deploy triggers.
  for (const service of services) {
    await triggerAllAsync('deploy:prepareResources', (handler) => handler({ state, service, metadata, options, context }));
  }

  beforeConnect?.(services);

  for (const service of services) {
    await triggerAllAsync('deploy:connectResources', (handler) => handler({ state, service, options, context }));
  }

  return state;
};

const isFunctionEntry = (entry: EntryState): entry is FunctionState => {
  return entry.type === 'aws:lambda.function';
};

const stepContext = {
  getDependencies: () => [],
  getConnections: () => []
} as unknown as StepContext;

/**
 * What the plan and the apply read from each entry: its parameters as the state file keeps them and, for a
 * function, the hashes, files, variables and bundle its getters give.
 */
export const getStateSnapshot = async (state: EntryStates) => {
  const entries = [];

  const allEntries = Object.values(state).filter((entry) => !!entry);

  for (const entry of allEntries.sort((a, b) => a.entryId.localeCompare(b.entryId))) {
    const snapshot: Record<string, unknown> = {
      type: entry.type,
      entryId: entry.entryId,
      dependencies: entry.dependencies,
      connections: entry.connections,
      parameters: JSON.parse(JSON.stringify(entry.parameters))
    };

    if (isFunctionEntry(entry)) {
      const { getFunctionFiles, getFunctionHash, getFunctionVariables, getFunctionBundle } = entry.parameters;

      const [sourceFile, dependencyFiles] = getFunctionFiles();

      const bundleFile = await getFunctionBundle(stepContext);

      snapshot.function = {
        sourceFile,
        dependencyFiles: dependencyFiles.map((file) => relative(process.cwd(), file)).sort(),
        valuesHash: await getFunctionHash(),
        variables: await getFunctionVariables(),
        bundleHash: createHash('sha256')
          .update(await readFile(bundleFile))
          .digest('hex')
      };
    }

    entries.push(snapshot);
  }

  // As a state file would keep it.
  return JSON.parse(JSON.stringify(entries));
};
