import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { createAgentService } from '@ez4/agent/library';
import { getAgentEntryDefinition } from '../src/runtime/bundle';

describe('agent bundle definition', () => {
  it('assert :: hook indexes follow the handlers order', () => {
    const agent = {
      ...createAgentService('EchoAgent'),
      provider: 'claude',
      model: 'm',
      instructions: 'i',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      finish: { name: 'finish', file: 'agent.ts', position: [0, 0] }
    } as never;
    const definition = getAgentEntryDefinition(agent);
    deepEqual(definition.hooks, { prepare: -1, finish: 0 });
    equal(definition.timeout, 3600);
    deepEqual(definition.tools, { mode: 'readonly' });
  });
});
