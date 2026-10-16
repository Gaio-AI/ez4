import type { OperationLogLine } from '@ez4/aws-common';
import type { ServiceDiscoveryClient } from '@aws-sdk/client-servicediscovery';
import type { NamespaceState } from '../src/namespace/types';
import type { StepOptions } from '@ez4/state';

import { describe, it, afterEach } from 'node:test';
import { equal, deepEqual, ok, rejects } from 'node:assert/strict';

import { setServiceDiscoveryClient, waitForOperation, createNamespaceResource } from '../src/namespace/client';
import { createNamespace, createNamespaceStateId } from '../src/namespace/service';
import { getNamespaceHandler } from '../src/namespace/handler';
import { NamespaceServiceType } from '../src/namespace/types';

describe('Cloud Map namespace and discovery service', () => {
  afterEach(() => {
    setServiceDiscoveryClient(null);
  });

  it('assert :: waitForOperation returns namespace id on SUCCESS after PENDING, calling sleep once', async () => {
    let callCount = 0;
    let sleepCount = 0;

    const fakeClient = {
      send: async () => {
        callCount++;
        if (callCount === 1) {
          return { Operation: { Status: 'PENDING' } };
        }
        return { Operation: { Status: 'SUCCESS', Targets: { NAMESPACE: 'ns-123' } } };
      }
    };

    setServiceDiscoveryClient(fakeClient as unknown as ServiceDiscoveryClient);

    const sleepStub = async (_ms: number) => {
      sleepCount++;
    };

    const result = await waitForOperation('op-1', sleepStub);

    equal(result, 'ns-123');
    equal(sleepCount, 1);
  });

  it('assert :: waitForOperation rejects when status is FAIL', async () => {
    const fakeClient = {
      send: async () => {
        return {
          Operation: {
            Status: 'FAIL',
            ErrorMessage: 'Namespace creation failed'
          }
        };
      }
    };

    setServiceDiscoveryClient(fakeClient as unknown as ServiceDiscoveryClient);

    await rejects(async () => waitForOperation('op-fail'), /Namespace creation failed/);
  });

  it('assert :: createNamespaceResource sends CreatePrivateDnsNamespaceCommand and CreateServiceCommand when missing', async () => {
    const sentCommands: Array<{ name: string; input: unknown }> = [];

    const fakeClient = {
      send: async (command: { constructor: { name: string }; input: unknown }) => {
        sentCommands.push({ name: command.constructor.name, input: command.input });

        switch (command.constructor.name) {
          case 'ListNamespacesCommand':
            return { Namespaces: [] };
          case 'CreatePrivateDnsNamespaceCommand':
            return { OperationId: 'op-create-ns' };
          case 'GetOperationCommand':
            return { Operation: { Status: 'SUCCESS', Targets: { NAMESPACE: 'ns-new' } } };
          case 'GetNamespaceCommand':
            return {
              Namespace: {
                Id: 'ns-new',
                Arn: 'arn:aws:servicediscovery:us-east-1:123456789012:namespace/ns-new'
              }
            };
          case 'ListServicesCommand':
            return { Services: [] };
          case 'CreateServiceCommand':
            return {
              Service: {
                Id: 'srv-new',
                Arn: 'arn:aws:servicediscovery:us-east-1:123456789012:service/srv-new'
              }
            };
          default:
            throw new Error(`Unexpected command ${command.constructor.name}`);
        }
      }
    };

    setServiceDiscoveryClient(fakeClient as unknown as ServiceDiscoveryClient);

    const stubLogger = { update: () => {} } as unknown as OperationLogLine;

    const result = await createNamespaceResource(
      stubLogger,
      {
        namespaceName: 'my-service.local',
        vpcId: 'vpc-1',
        serviceName: 'proxy',
        tags: { Env: 'test' }
      },
      async () => {}
    );

    equal(result.namespaceId, 'ns-new');
    equal(result.namespaceArn, 'arn:aws:servicediscovery:us-east-1:123456789012:namespace/ns-new');
    equal(result.discoveryServiceId, 'srv-new');
    equal(result.discoveryServiceArn, 'arn:aws:servicediscovery:us-east-1:123456789012:service/srv-new');

    const createNsCmd = sentCommands.find((c) => c.name === 'CreatePrivateDnsNamespaceCommand');
    ok(createNsCmd !== undefined);
    const nsInput = createNsCmd.input as { Name: string; Vpc: string; Tags: Array<{ Key: string; Value: string }> };
    equal(nsInput.Name, 'my-service.local');
    equal(nsInput.Vpc, 'vpc-1');
    deepEqual(nsInput.Tags, [{ Key: 'Env', Value: 'test' }]);

    const createSrvCmd = sentCommands.find((c) => c.name === 'CreateServiceCommand');
    ok(createSrvCmd !== undefined);
    const srvInput = createSrvCmd.input as {
      Name: string;
      NamespaceId: string;
      DnsConfig: { RoutingPolicy: string; DnsRecords: Array<{ Type: string; TTL: number }> };
    };
    equal(srvInput.Name, 'proxy');
    equal(srvInput.NamespaceId, 'ns-new');
    deepEqual(srvInput.DnsConfig.DnsRecords, [{ Type: 'A', TTL: 10 }]);
  });

  it('assert :: createNamespace creates valid state entry', () => {
    const states: Record<string, NamespaceState> = {};
    const state = createNamespace(states, {
      namespaceName: 'test.local',
      vpcId: 'vpc-99',
      serviceName: 'agent-proxy'
    });

    equal(state.type, NamespaceServiceType);
    equal(state.parameters.namespaceName, 'test.local');
    equal(state.parameters.vpcId, 'vpc-99');
    equal(state.parameters.serviceName, 'agent-proxy');
    equal(state.entryId, createNamespaceStateId('test.local'));
    ok(states[state.entryId] !== undefined);
  });

  it('assert :: handler equals compares namespaceArn', () => {
    const handler = getNamespaceHandler();

    const candidate: NamespaceState = {
      type: NamespaceServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: { namespaceName: 'test.local', vpcId: 'vpc-1', serviceName: 'proxy' },
      result: {
        namespaceId: 'ns-1',
        namespaceArn: 'arn:aws:servicediscovery:us-east-1:123456789012:namespace/ns-1',
        discoveryServiceId: 'srv-1',
        discoveryServiceArn: 'arn:aws:servicediscovery:us-east-1:123456789012:service/srv-1'
      }
    };

    const same = { ...candidate };
    const diff = {
      ...candidate,
      result: { ...candidate.result!, namespaceArn: 'arn:other' }
    };

    ok(handler.equals(candidate, same));
    ok(!handler.equals(candidate, diff));
  });

  it('assert :: handler preview detects parameter changes', async () => {
    const handler = getNamespaceHandler();
    const options = {} as StepOptions;

    const candidate: NamespaceState = {
      type: NamespaceServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: { namespaceName: 'test.local', vpcId: 'vpc-1', serviceName: 'proxy' }
    };

    const same = { ...candidate };
    const diff: NamespaceState = {
      type: NamespaceServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: { namespaceName: 'test.local', vpcId: 'vpc-2', serviceName: 'proxy' }
    };

    equal(await handler.preview(candidate, same, options), undefined);
    const changes = await handler.preview(candidate, diff, options);
    ok(changes !== undefined);
    equal(changes.counts, 1);
  });
});
