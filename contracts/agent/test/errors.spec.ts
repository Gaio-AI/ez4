import { deepEqual, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  IncompleteServiceError,
  InvalidCpuMemoryCombinationError,
  UnknownPermissionError,
  InvalidGrantResourceError,
  InvalidWorkspaceRepoError,
  DuplicateWorkspaceRepoError,
  UnknownWorkflowAgentError,
  InvalidMaxStepsError
} from '@ez4/agent/library';
import { parseFile } from './common/parser';

describe('agent metadata errors', () => {
  it('assert :: incomplete agent', () => {
    const [error] = parseFile('incomplete-service', 1);
    ok(error instanceof IncompleteServiceError);
  });

  it('assert :: invalid optional agent members report agent and member', () => {
    const errors = parseFile('invalid-optional-members', 6);
    deepEqual(
      errors.map((error) => {
        ok(error instanceof IncompleteServiceError);
        return error.properties;
      }),
      [
        ['InvalidTools.tools'],
        ['InvalidMcpServers.mcpServers'],
        ['InvalidImage.image'],
        ['InvalidEgress.egress'],
        ['InvalidSecrets.secrets'],
        ['InvalidStatements.permissions.statements']
      ]
    );
  });

  it('assert :: invalid cpu/memory combo', () => {
    const [error] = parseFile('invalid-resources', 1);
    ok(error instanceof InvalidCpuMemoryCombinationError);
  });

  it('assert :: unknown permission', () => {
    const [error] = parseFile('invalid-permission', 1);
    ok(error instanceof UnknownPermissionError);
    deepEqual(error.permission, 'logs-write');
  });

  it('assert :: a CodeArtifact grant resource without a repository is rejected', () => {
    const [error] = parseFile('invalid-grant-resource', 1);
    ok(error instanceof InvalidGrantResourceError);
    deepEqual(error.resource, 'acme');
  });

  it('assert :: non-https workspace repo is rejected naming agent and url', () => {
    const errors = parseFile('invalid-workspace-url', 1);
    const error = errors.find((entry) => entry instanceof InvalidWorkspaceRepoError);
    ok(error);
    ok(error.message.includes('InvalidWorkspaceAgent') && error.message.includes('git@github.com:acme/api.git'));
  });

  it('assert :: duplicate workspace repo names are rejected', () => {
    const errors = parseFile('duplicate-workspace-repo', 1);
    ok(errors.some((error) => error instanceof DuplicateWorkspaceRepoError && error.message.includes('api')));
  });

  it('assert :: GitHub App auth without every credential is rejected', () => {
    const errors = parseFile('invalid-workspace-github-app', 1);
    ok(
      errors.some(
        (error) => error instanceof IncompleteServiceError && error.properties.includes('MissingKeyAgent.workspace.auth.githubApp')
      )
    );
  });

  it('assert :: unknown workflow agent alias reports workflow and agent name', () => {
    const errors = parseFile('invalid-workflow-agent', 1);
    const error = errors.find((entry) => entry instanceof UnknownWorkflowAgentError);
    ok(error);
    ok(error.message.includes('InvalidWorkflowAgent') && error.message.includes('ghost'));
  });

  it('assert :: invalid maxSteps is rejected naming workflow and value', () => {
    const errors = parseFile('invalid-workflow-steps', 1);
    const error = errors.find((entry) => entry instanceof InvalidMaxStepsError);
    ok(error);
    ok(error.message.includes('InvalidWorkflowSteps') && error.message.includes('0'));
  });
});
