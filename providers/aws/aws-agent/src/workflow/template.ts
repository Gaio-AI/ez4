import type { SQSEvent, Context } from 'aws-lambda';
import type { Agent } from '@ez4/agent';
import type { WorkflowMessage, WorkflowStore, WorkflowInvoker } from './runtime';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '../client';
import { runWorkflowStep } from './runtime';
import { getWorkflowStateKey } from '../utils/names';

declare const __MODULE_PATH: string;
type GenericWorkflow = Agent.Workflow<Agent.Input, unknown, Record<string, Agent.Service<Agent.Input, Agent.Output>>>;

declare function handle(
  request: Agent.WorkflowRequest<GenericWorkflow>,
  context: object
): Promise<Agent.WorkflowStep<unknown, Record<string, Agent.Service<Agent.Input, Agent.Output>>>> | Agent.WorkflowStep<unknown, Record<string, Agent.Service<Agent.Input, Agent.Output>>>;
declare const __EZ4_CONTEXT: object;

export const getWorkflowTemplateFile = () => {
  if (typeof __MODULE_PATH !== 'undefined') {
    return join(__MODULE_PATH, '../src/workflow/template.ts');
  }
  return join(import.meta.dirname, 'template.ts');
};

const s3 = new S3Client({});

const createWorkflowStore = (bucket: string, workflow: string): WorkflowStore => {
  return {
    read: async (runId: string) => {
      try {
        const res = await s3.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: getWorkflowStateKey(workflow, runId)
          })
        );
        if (!res.Body) {
          return undefined;
        }
        const bodyStr = await res.Body.transformToString();
        const run = JSON.parse(bodyStr) as Agent.WorkflowRun<unknown>;
        const etag = res.ETag ? res.ETag.replace(/^"(.*)"$/, '$1') : '';
        return { run, etag };
      } catch (error: unknown) {
        const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
          return undefined;
        }
        throw error;
      }
    },
    write: async (run: Agent.WorkflowRun<unknown>, etag: string | undefined): Promise<boolean> => {
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: getWorkflowStateKey(workflow, run.runId),
            Body: JSON.stringify(run),
            ContentType: 'application/json',
            ...(etag === undefined ? { IfNoneMatch: '*' } : { IfMatch: etag.startsWith('"') ? etag : `"${etag}"` })
          })
        );
        return true;
      } catch (error: unknown) {
        const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err?.name === 'PreconditionFailed' || err?.$metadata?.httpStatusCode === 412) {
          return false;
        }
        throw error;
      }
    }
  };
};

type AgentClientInstance = Agent.Client<Agent.Service<Agent.Input, Agent.Output>>;
const agentClients = new Map<string, AgentClientInstance>();

const getInvoker = (workflow: string): WorkflowInvoker => {
  if (agentClients.size === 0) {
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('EZ4_WORKFLOW_AGENT_') && value) {
        const alias = key.slice('EZ4_WORKFLOW_AGENT_'.length).toLowerCase();
        try {
          const rawParams = JSON.parse(value);
          const params = {
            ...rawParams,
            subnets:
              typeof rawParams.subnets === 'string'
                ? rawParams.subnets.split(',').filter(Boolean)
                : rawParams.subnets,
            securityGroups:
              typeof rawParams.securityGroups === 'string'
                ? rawParams.securityGroups.split(',').filter(Boolean)
                : rawParams.securityGroups
          };
          const client = Client.make(params);
          agentClients.set(alias, client);
          if (params.agentName) {
            agentClients.set(params.agentName.toLowerCase(), client);
            agentClients.set(params.agentName, client);
          }
        } catch {
          // ignore malformed env var
        }
      }
    }
  }

  return async (agent: string, input: unknown, options?: Agent.InvokeOptions) => {
    const client = agentClients.get(agent) ?? agentClients.get(agent.toLowerCase());
    if (!client) {
      throw new Error(`Agent client "${agent}" not configured in workflow "${workflow}".`);
    }
    const result = await client.invoke(input as Agent.Input, options);
    return { id: result.id };
  };
};

const parseWorkflowMessage = (body: string): WorkflowMessage => {
  const data = JSON.parse(body);
  if (data && typeof data === 'object') {
    if (data.type === 'start') {
      return {
        type: 'start',
        runId: data.runId,
        input: data.input
      };
    }
    if (data.type === 'result') {
      return {
        type: 'result',
        result: data.result
      };
    }
    if ('id' in data && 'agent' in data && 'status' in data) {
      return {
        type: 'result',
        result: data as unknown as Agent.Result<Agent.Service<Agent.Input, Agent.Output>>
      };
    }
  }
  throw new Error(`Invalid workflow message format: ${body}`);
};

export async function workflowEntryPoint(event: SQSEvent, _context: Context): Promise<void> {
  const workflowName = process.env.EZ4_WORKFLOW_NAME ?? 'workflow';
  const bucket = process.env.EZ4_WORKFLOW_BUCKET;
  if (!bucket) {
    throw new Error('EZ4_WORKFLOW_BUCKET is not set.');
  }
  const maxSteps = process.env.EZ4_WORKFLOW_MAX_STEPS ? parseInt(process.env.EZ4_WORKFLOW_MAX_STEPS, 10) : 10;

  const store = createWorkflowStore(bucket, workflowName);
  const invoke = getInvoker(workflowName);

  for (const record of event.Records) {
    const message = parseWorkflowMessage(record.body);
    await runWorkflowStep({
      workflow: workflowName,
      maxSteps,
      message,
      handler: (req) => handle(req, typeof __EZ4_CONTEXT !== 'undefined' ? __EZ4_CONTEXT : {}),
      store,
      invoke,
      newId: () => randomUUID(),
      now: () => new Date()
    });
  }
}
