import { buildReflection } from '@ez4/project/library';
import { equal } from 'node:assert/strict';
import { getAgentServicesMetadata, getAgentWorkflowServicesMetadata } from '@ez4/agent/library';

export const parseFile = (fileName: string, errorCount: number) => {
  const sourceFile = `./test/input/${fileName}.ts`;

  const reflection = buildReflection([sourceFile]);
  const agentServices = getAgentServicesMetadata(reflection);
  const workflowServices = getAgentWorkflowServicesMetadata(reflection);
  const allErrors = [...agentServices.errors, ...workflowServices.errors];

  equal(allErrors.length, errorCount);

  return allErrors;
};
