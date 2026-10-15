import type { EntryState, StepContext } from '@ez4/state';
import type { LinkedVariables } from '@ez4/project/library';
import type { Arn, BundledPackage } from '@ez4/aws-common';
import type { CreateRequest, CreateResponse } from './client';

export const FunctionServiceName = 'AWS:Lambda/Function';

export const FunctionServiceType = 'aws:lambda.function';

export type GetFunctionFiles = () => [string, string[]];
export type GetFunctionVariables = () => Promise<LinkedVariables> | LinkedVariables;
export type GetFunctionBundle = (context: StepContext) => Promise<string> | string;
export type GetFunctionHash = () => Promise<string | undefined> | string | undefined;

export type FunctionRelease = {
  tagName?: string;
  variableName?: string;
  version: string;
};

export type FunctionVpcConfig = {
  subnetIds: string[];
  securityGroupIds: string[];

  /**
   * Set when every subnet is dual-stack: the function then sends IPv6 traffic through the subnets' own IPv6 route
   * (e.g. an egress-only internet gateway) instead of the IPv4 one.
   */
  ipv6AllowedForDualStack?: boolean;
};

export type FunctionParameters = Omit<CreateRequest, 'logGroup' | 'roleArn' | 'publish' | 'variables' | 'vpcConfig'> & {
  getFunctionFiles: GetFunctionFiles;
  getFunctionVariables: GetFunctionVariables;
  getFunctionBundle: GetFunctionBundle;
  getFunctionHash: GetFunctionHash;
  release?: FunctionRelease;
  dependencies?: string[];
};

export type FunctionResult = CreateResponse & {
  variables: LinkedVariables;
  valuesHash?: string;
  sourceHash: string;
  bundleHash: string;
  filesHash?: string;
  bundledPackages?: BundledPackage[];
  packagesHash?: string;
  logGroup?: string;
  roleArn: Arn;
  vpcConfig?: FunctionVpcConfig;
};

export type FunctionState = EntryState & {
  type: typeof FunctionServiceType;
  parameters: FunctionParameters;
  result?: FunctionResult;
};
