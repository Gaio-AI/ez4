import type { EntryState, EntryStates } from '@ez4/state';
import type { DeployOptions, IdentityGrant } from '@ez4/project/library';
import type { PolicyState, RoleState } from '@ez4/aws-identity';
import type { LogGroupState } from '@ez4/aws-logs';

import { join } from 'node:path';
import { getFunctionBundle } from '@ez4/aws-common';
import { createFunction } from '@ez4/aws-function';
import {
  buildPermissionsBoundaryArn,
  createPolicy,
  createPolicyDocument,
  createRole,
  createRoleDocument,
  createRoleStatement
} from '@ez4/aws-identity';
import { ArchitectureType, RuntimeType } from '@ez4/project';

import { createEventsRule, createEventsRuleStateId } from '@ez4/aws-events';
import { getAgentsBaseName } from '../utils/names';

// __MODULE_PATH is defined by the package bundler.
declare const __MODULE_PATH: string;

export const getDispatcherTemplateFile = () => join(__MODULE_PATH, '../lib/dispatcher.ts');

export const getDispatcherFunctionName = (options: DeployOptions) => `${getAgentsBaseName(options)}-dispatcher`;

export const getTaskStoppedRuleName = (options: DeployOptions) => `${getAgentsBaseName(options)}-task-stopped`;

export const getSweepRuleName = (options: DeployOptions) => `${getAgentsBaseName(options)}-sweep`;

export const buildTaskStoppedPattern = (clusterArn: string) =>
  JSON.stringify({
    source: ['aws.ecs'],
    'detail-type': ['ECS Task State Change'],
    detail: { lastStatus: ['STOPPED'], clusterArn: [clusterArn] }
  });

export const buildDispatcherGrants = (region: string, accountId: string, bucketName: string, clusterName: string): IdentityGrant[] => [
  { permissions: ['s3:GetObject', 's3:PutObject'], resourceIds: [`arn:aws:s3:::${bucketName}/*`] },
  { permissions: ['s3:ListBucket'], resourceIds: [`arn:aws:s3:::${bucketName}`] },
  { permissions: ['sqs:SendMessage'], resourceIds: [`arn:aws:sqs:${region}:${accountId}:*.fifo`] },
  { permissions: ['ecs:StopTask'], resourceIds: [`arn:aws:ecs:${region}:${accountId}:task/${clusterName}/*`] },
  { permissions: ['logs:CreateLogStream', 'logs:PutLogEvents'], resourceIds: [`arn:aws:logs:${region}:${accountId}:log-group:*`] }
];

export const buildDispatcherBundle = () =>
  getFunctionBundle('@ez4/aws-agent', {
    groupName: 'agents-dispatcher',
    filePrefix: 'agent',
    templateFile: getDispatcherTemplateFile(),
    resourceName: 'agents-dispatcher',
    handlers: [],
    target: 'node24'
  });

export type DispatcherInput = {
  region: string;
  accountId: string;
  bucketName: string;
  clusterName: string;
  logGroup: LogGroupState;
  bundle: () => Promise<string>;
};

/** Creates the dispatcher Lambda and its two rules once per project; returns false when already present. */
export const prepareDispatcher = <E extends EntryState>(state: EntryStates<E>, options: DeployOptions, input: DispatcherInput): boolean => {
  if (state[createEventsRuleStateId(getSweepRuleName(options))]) {
    return false;
  }

  const { region, accountId, bucketName, clusterName } = input;
  const baseName = getAgentsBaseName(options);

  const policy = createPolicy(state, {
    policyName: `${baseName}-dispatcher-policy`,
    policyDocument: createPolicyDocument(buildDispatcherGrants(region, accountId, bucketName, clusterName)),
    tags: options.tags
  }) as PolicyState;

  const role: RoleState = createRole(state, [policy], {
    roleName: `${baseName}-dispatcher-role`,
    roleDocument: createRoleDocument([
      createRoleStatement({ permissions: ['sts:AssumeRole'], resourceIds: [] }, [{ account: 'lambda.amazonaws.com' }], accountId)
    ]),
    permissionsBoundary: buildPermissionsBoundaryArn(accountId, options.permissionsBoundary),
    tags: options.tags
  });

  const templateFile = getDispatcherTemplateFile();

  const fn = createFunction(state, role, input.logGroup, {
    functionName: getDispatcherFunctionName(options),
    handlerName: 'dispatcherEntryPoint',
    sourceFile: templateFile,
    description: 'Delivers agent results to caller queues',
    architecture: ArchitectureType.Arm,
    runtime: RuntimeType.Node24,
    timeout: 60,
    memory: 256,
    retryAttempts: 0,
    tags: options.tags,
    getFunctionVariables: () => ({ EZ4_AGENT_BUCKET: bucketName }),
    getFunctionBundle: () => input.bundle(),
    getFunctionFiles: () => [templateFile, []],
    getFunctionHash: () => undefined
  });

  const clusterArn = `arn:aws:ecs:${region}:${accountId}:cluster/${clusterName}`;

  createEventsRule(state, fn, { name: getTaskStoppedRuleName(options), eventPattern: buildTaskStoppedPattern(clusterArn) });
  createEventsRule(state, fn, { name: getSweepRuleName(options), scheduleExpression: 'rate(15 minutes)' });

  return true;
};
