import type { Agent } from '@ez4/agent';
import type { ObjectSchema } from '@ez4/schema';
import type { Service as CommonService } from '@ez4/common';
import type { AgentStorage } from './storage';
import type { AgentProvider } from './types';
import { validate, createValidatorContext, getErrorDetails } from '@ez4/validator';
import { createArtifactsClient } from './artifacts';
import { createTimeoutTimer } from './timer';
import { checkoutWorkspace, publishWorkspace, type WorkspaceRuntime } from '../workspace/runtime';

export interface InvocationEnvelope {
  input: unknown;
  correlation?: string;
  replyTo?: string;
  deadline?: string;
  workspace?: Agent.WorkspaceRef[];
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
  context?: object;
  workdir?: string;
  env?: Record<string, string>;
  workspace?: WorkspaceRuntime;
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
    context = {},
    workdir = process.cwd(),
    env = {},
    workspace
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
    let workspaceRequest: Agent.WorkspaceRequest | undefined;

    if (workspace) {
      workspaceRequest = await checkoutWorkspace(workspace, effectiveWorkdir, envelope.workspace);
    }

    if (prepare) {
      try {
        const prepareResult = await prepare(
          {
            id: invocationId,
            input: envelope.input,
            workdir: effectiveWorkdir,
            artifacts,
            workspace: workspaceRequest
          },
          context as CommonService.Context<Agent.Service<any, any>>
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
    let workspaceRefs: Agent.WorkspaceRef[] | undefined;

    if (workspace && workspaceRequest && tools.mode === 'edit') {
      workspaceRefs = await publishWorkspace(workspace, workspaceRequest, agentName, invocationId);
    }

    if (finish) {
      try {
        effectiveOutput = await finish(
          {
            id: invocationId,
            input: envelope.input,
            output: providerResponse.output,
            workdir: effectiveWorkdir,
            artifacts,
            workspace: workspaceRequest ? { ...workspaceRequest, refs: workspaceRefs ?? [] } : undefined
          },
          context as CommonService.Context<Agent.Service<any, any>>
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
      workspace: workspaceRefs,
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

  // The result goes to S3 for the caller; the log keeps the reason next to the task that failed.
  if (result.status !== 'succeeded') {
    console.error(`Agent ${agentName} invocation ${invocationId} ${result.status}: ${result.error?.code} ${result.error?.message}`);
  }

  await storage.writeJson(resultKey, result);
};
