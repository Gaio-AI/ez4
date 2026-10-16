import type { PolicyDocument, PolicyParameters, PolicyResult, PolicyState } from '@ez4/aws-identity';
import type { StepContext } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { getPolicyHandler } from '../src/policy/handler';
import { hasPolicyDocumentChanges, resolvePolicyParameters } from '../src/policy/handler';
import { PolicyServiceType } from '../src/policy/types';
import { getPolicyDocument } from './common/policy';

const baseDocument: PolicyDocument = getPolicyDocument('AllowEFS1');
const updatedDocument: PolicyDocument = getPolicyDocument('AllowEFS2');

describe('policy document deploy-time update detection', () => {
  it('resolves policy document via getPolicyDocument with step context', () => {
    const mockContext = {
      getDependencies: () => [{ result: { fileSystemArn: 'arn:aws:efs:fs-2222' } }]
    } as unknown as StepContext;

    const parameters: PolicyParameters = {
      policyName: 'test-policy',
      policyDocument: baseDocument,
      getPolicyDocument: () => updatedDocument
    };

    const resolved = resolvePolicyParameters(parameters, mockContext);
    equal(resolved.policyDocument, updatedDocument);
  });

  it('detects changes when resolved document differs from previous result.resolvedDocument', () => {
    const candidate: PolicyParameters = {
      policyName: 'test-policy',
      policyDocument: updatedDocument
    };
    const current: PolicyParameters = {
      policyName: 'test-policy',
      policyDocument: baseDocument
    };
    const result: PolicyResult = {
      policyArn: 'arn:aws:iam::123456789012:policy/test-policy',
      currentVersion: 'v1',
      resolvedDocument: baseDocument,
      versionHistory: ['v1']
    };

    equal(hasPolicyDocumentChanges(candidate, current, result), true);
  });

  it('detects no change when resolved document matches result.resolvedDocument', () => {
    const candidate: PolicyParameters = {
      policyName: 'test-policy',
      policyDocument: baseDocument
    };
    const current: PolicyParameters = {
      policyName: 'test-policy',
      policyDocument: baseDocument
    };
    const result: PolicyResult = {
      policyArn: 'arn:aws:iam::123456789012:policy/test-policy',
      currentVersion: 'v1',
      resolvedDocument: baseDocument,
      versionHistory: ['v1']
    };

    equal(hasPolicyDocumentChanges(candidate, current, result), false);
  });

  it('previews an update when candidate has getPolicyDocument', async () => {
    const handler = getPolicyHandler();

    const candidate: PolicyState = {
      type: PolicyServiceType,
      entryId: 'policy-1',
      dependencies: ['dep-1'],
      parameters: {
        policyName: 'test-policy',
        policyDocument: baseDocument,
        getPolicyDocument: () => updatedDocument
      }
    };

    const current: PolicyState = {
      type: PolicyServiceType,
      entryId: 'policy-1',
      dependencies: ['dep-1'],
      parameters: {
        policyName: 'test-policy',
        policyDocument: baseDocument
      },
      result: {
        policyArn: 'arn:aws:iam::123456789012:policy/test-policy',
        currentVersion: 'v1',
        resolvedDocument: baseDocument,
        versionHistory: ['v1']
      }
    };

    const preview = await handler.preview(candidate, current, { force: false });
    ok(preview);
    ok(preview.counts >= 1);
    equal(preview.update?.policyDocument, true);
  });

  it('skips preview update when static policy has no getPolicyDocument and no document changes', async () => {
    const handler = getPolicyHandler();

    const candidate: PolicyState = {
      type: PolicyServiceType,
      entryId: 'policy-1',
      dependencies: ['dep-1'],
      parameters: {
        policyName: 'test-policy',
        policyDocument: baseDocument
      }
    };

    const current: PolicyState = {
      type: PolicyServiceType,
      entryId: 'policy-1',
      dependencies: ['dep-1'],
      parameters: {
        policyName: 'test-policy',
        policyDocument: baseDocument
      },
      result: {
        policyArn: 'arn:aws:iam::123456789012:policy/test-policy',
        currentVersion: 'v1',
        resolvedDocument: baseDocument,
        versionHistory: ['v1']
      }
    };

    const preview = await handler.preview(candidate, current, { force: false });
    equal(preview, undefined);
  });

  describe('when the plan can resolve the document', () => {
    const makeCurrent = (): PolicyState => ({
      type: PolicyServiceType,
      entryId: 'policy-1',
      dependencies: ['dep-1'],
      parameters: {
        policyName: 'test-policy',
        policyDocument: baseDocument
      },
      result: {
        policyArn: 'arn:aws:iam::123456789012:policy/test-policy',
        currentVersion: 'v1',
        resolvedDocument: updatedDocument,
        versionHistory: ['v1']
      }
    });

    const makeCandidate = (getPolicyDocument: PolicyParameters['getPolicyDocument']): PolicyState => ({
      type: PolicyServiceType,
      entryId: 'policy-1',
      dependencies: ['dep-1'],
      parameters: {
        policyName: 'test-policy',
        policyDocument: baseDocument,
        getPolicyDocument
      }
    });

    const options = { force: false, getDependencies: () => [] };

    it('skips the preview update when the resolved document is the stored one', async () => {
      const preview = await getPolicyHandler().preview(
        makeCandidate(() => updatedDocument),
        makeCurrent(),
        options
      );

      equal(preview, undefined);
    });

    it('previews the document change when the resolved document differs from the stored one', async () => {
      const preview = await getPolicyHandler().preview(
        makeCandidate(() => getPolicyDocument('AllowEFS3')),
        makeCurrent(),
        options
      );

      ok(preview);
      ok(preview.counts >= 1);
      ok(preview.nested?.policyDocument);
    });

    it('hands the plan dependencies to getPolicyDocument', async () => {
      const dependencies = [{ result: { fileSystemArn: 'arn:aws:efs:fs-3333' } }];

      let seen: unknown;

      await getPolicyHandler().preview(
        makeCandidate((context) => {
          seen = context.getDependencies();

          return updatedDocument;
        }),
        makeCurrent(),
        { force: false, getDependencies: () => dependencies as never }
      );

      equal(seen, dependencies);
    });

    it('previews an update when the document cannot be resolved yet', async () => {
      const candidate = makeCandidate(() => {
        throw new Error('Workspace file system or access point ARN is unavailable');
      });

      const preview = await getPolicyHandler().preview(candidate, makeCurrent(), options);

      ok(preview);
      ok(preview.counts >= 1);
      equal(preview.update?.policyDocument, true);
    });
  });
});
