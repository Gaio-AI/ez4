import type { AgentEntryDefinition } from '@ez4/aws-agent/library';
import { startAgent } from '@ez4/aws-agent/library';

declare const __EZ4_AGENT: AgentEntryDefinition;
declare const __EZ4_HANDLERS: Function[];
declare const __EZ4_CONTEXT: object;

startAgent(__EZ4_AGENT, __EZ4_HANDLERS, __EZ4_CONTEXT)
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
