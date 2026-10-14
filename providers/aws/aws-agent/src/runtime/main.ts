import type { Agent } from '@ez4/agent';
import type { ObjectSchema } from '@ez4/schema';
import type { Service as CommonService } from '@ez4/common';
import type { AgentStorage } from './storage';
import type { AgentProvider } from './types';
import { validate, createValidatorContext, getErrorDetails } from '@ez4/validator';
import { createArtifactsClient } from './artifacts';
import { createTimeoutTimer } from './timer';

export interface InvocationEnvelope {
  input: unknown;
  correlation?: string;
  replyTo?: string;
  deadline?: string;
}

export interface RunAgentRuntimeParameters {
  agentName: string;
  invocationId: string;
  inputSchema: ObjectSchema;
  outputSchema: ObjectSchema;
  storage: AgentStorage;
  provider: AgentProvider;
  tools: Agent.Tools;
  mcpServers: Record<string, Agent.McpServer>;
  instructions: string;
  model: string;
  prepare?: Agent.PrepareHook<unknown>;
  finish?: Agent.FinishHook<unknown, unknown>;
  timeoutSeconds: number;
  workdir?: string;
  env?: Record<string, string>;
}

export const runAgentRuntime = async (parameters: RunAgentRuntimeParameters): Promise<number> => {
  const {
    agentName,
    invocationId,
    inputSchema,
    outputSchema,
    storage,
    provider,
    tools,
    mcpServers,
    instructions,
    model,
    prepare,
    finish,
    timeoutSeconds,
    workdir = process.cwd(),
    env = {}
  } = parameters;

  const timer = createTimeoutTimer(timeoutSeconds);
  let correlation: string | undefined;

  try {
    const invocationKey = `invocations/${agentName}/${invocationId}.json`;
    const envelope = await storage.readJson<InvocationEnvelope>(invocationKey);
    correlation = envelope.correlation;

    const validationErrors = await validate(envelope.input, inputSchema, createValidatorContext({ property: '$input' }));
    if (validationErrors.length > 0) {
      const details = getErrorDetails(validationErrors);
      const message = `Input validation failed: ${details.map((d) => d.message).join('; ')}`;
      await writeResult(storage, agentName, invocationId, {
        id: invocationId,
        agent: agentName,
        status: 'failed',
        error: { code: 'invalid_input', message },
        correlation,
        finishedAt: new Date().toISOString()
      });
      return 1;
    }

    const artifacts = createArtifactsClient(storage, agentName, invocationId);
    let effectivePrompt = typeof envelope.input === 'string' ? envelope.input : JSON.stringify(envelope.input);
    let effectiveWorkdir = workdir;
    const dummyContext = {} as unknown as CommonService.Context<Agent.Service<any, any>>;

    if (prepare) {
      try {
        const prepareResult = await prepare(
          {
            id: invocationId,
            input: envelope.input,
            workdir: effectiveWorkdir,
            artifacts
          },
          dummyContext
        );
        if (prepareResult?.prompt) {
          effectivePrompt = prepareResult.prompt;
        }
        if (prepareResult?.workdir) {
          effectiveWorkdir = prepareResult.workdir;
        }
      } catch (prepErr: unknown) {
        const message = prepErr instanceof Error ? prepErr.message : String(prepErr);
        await writeResult(storage, agentName, invocationId, {
          id: invocationId,
          agent: agentName,
          status: 'failed',
          error: { code: 'hook_error', message },
          correlation,
          finishedAt: new Date().toISOString()
        });
        return 1;
      }
    }

    let providerResponse;
    try {
      providerResponse = await provider.run({
        model,
        instructions,
        prompt: effectivePrompt,
        workdir: effectiveWorkdir,
        tools,
        mcpServers,
        outputSchema,
        env,
        signal: timer.signal
      });
    } catch (provErr: unknown) {
      if (timer.signal.aborted) {
        await writeResult(storage, agentName, invocationId, {
          id: invocationId,
          agent: agentName,
          status: 'timed_out',
          error: { code: 'timeout', message: 'Execution timed out' },
          correlation,
          finishedAt: new Date().toISOString()
        });
        return 1;
      }

      const message = provErr instanceof Error ? provErr.message : String(provErr);
      await writeResult(storage, agentName, invocationId, {
        id: invocationId,
        agent: agentName,
        status: 'failed',
        error: { code: 'provider_error', message },
        correlation,
        finishedAt: new Date().toISOString()
      });
      return 1;
    }

    if (timer.signal.aborted) {
      await writeResult(storage, agentName, invocationId, {
        id: invocationId,
        agent: agentName,
        status: 'timed_out',
        error: { code: 'timeout', message: 'Execution timed out' },
        correlation,
        finishedAt: new Date().toISOString()
      });
      return 1;
    }

    let effectiveOutput = providerResponse.output;

    if (finish) {
      try {
        effectiveOutput = await finish(
          {
            id: invocationId,
            input: envelope.input,
            output: providerResponse.output,
            workdir: effectiveWorkdir,
            artifacts
          },
          dummyContext
        );
      } catch (finishErr: unknown) {
        const message = finishErr instanceof Error ? finishErr.message : String(finishErr);
        await writeResult(storage, agentName, invocationId, {
          id: invocationId,
          agent: agentName,
          status: 'failed',
          error: { code: 'hook_error', message },
          correlation,
          finishedAt: new Date().toISOString()
        });
        return 1;
      }
    }

    const outputErrors = await validate(effectiveOutput, outputSchema, createValidatorContext({ property: '$output' }));
    if (outputErrors.length > 0) {
      const details = getErrorDetails(outputErrors);
      const message = `Output validation failed: ${details.map((d) => d.message).join('; ')}`;
      await writeResult(storage, agentName, invocationId, {
        id: invocationId,
        agent: agentName,
        status: 'failed',
        error: { code: 'invalid_output', message },
        correlation,
        finishedAt: new Date().toISOString()
      });
      return 1;
    }

    await writeResult(storage, agentName, invocationId, {
      id: invocationId,
      agent: agentName,
      status: 'succeeded',
      output: effectiveOutput,
      correlation,
      finishedAt: new Date().toISOString()
    });

    return 0;
  } catch (err: unknown) {
    if (timer.signal.aborted) {
      await writeResult(storage, agentName, invocationId, {
        id: invocationId,
        agent: agentName,
        status: 'timed_out',
        error: { code: 'timeout', message: 'Execution timed out' },
        correlation,
        finishedAt: new Date().toISOString()
      });
      return 1;
    }

    const message = err instanceof Error ? err.message : String(err);
    await writeResult(storage, agentName, invocationId, {
      id: invocationId,
      agent: agentName,
      status: 'failed',
      error: { code: 'provider_error', message },
      correlation,
      finishedAt: new Date().toISOString()
    });
    return 1;
  } finally {
    timer.dispose();
  }
};

const writeResult = async (
  storage: AgentStorage,
  agentName: string,
  invocationId: string,
  result: Agent.Result<Agent.Service<any, any>>
): Promise<void> => {
  const resultKey = `results/${agentName}/${invocationId}.json`;
  await storage.writeJson(resultKey, result);
};
