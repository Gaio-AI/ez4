// What the agent template (`lib/agent.ts`) imports. Not the library, which reaches the deploy code and through
// `@ez4/project` bundles TypeScript into the image.
export { startAgent, type AgentEntryDefinition } from './runtime/entry';
