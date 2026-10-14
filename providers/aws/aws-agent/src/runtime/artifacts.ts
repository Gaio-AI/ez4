import type { Agent } from '@ez4/agent';
import type { AgentStorage } from './storage';

export const createArtifactsClient = (
  storage: AgentStorage,
  currentAgent: string,
  currentId: string
): Agent.Artifacts => ({
  async put(key: string, body: string | Uint8Array): Promise<void> {
    const bytes = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
    await storage.putBuffer(`artifacts/${currentAgent}/${currentId}/${key}`, bytes);
  },
  async get(agent: string, id: string, key: string): Promise<Uint8Array | undefined> {
    return storage.getBuffer(`artifacts/${agent}/${id}/${key}`);
  }
});
