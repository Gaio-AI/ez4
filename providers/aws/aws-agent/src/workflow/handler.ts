import type { SQSEvent } from 'aws-lambda';
import type { Agent } from '@ez4/agent';
import type { RunWorkflowStepParameters, WorkflowMessage, WorkflowStore, WorkflowInvoker } from './runtime';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runWorkflowStep } from './runtime';
import { getWorkflowAgentContextName, getWorkflowStateKey } from '../utils/names';

// __MODULE_PATH is defined by the package bundler.
declare const __MODULE_PATH: string;

export const getWorkflowTemplateFile = () => join(__MODULE_PATH, '../lib/workflow.ts');

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

/**
 * Runs one workflow step per record; agent clients come from the bundled context, built at deploy from deployed entries.
 */
export const handleWorkflowEvent = async (
  event: SQSEvent,
  handler: RunWorkflowStepParameters['handler'],
  context: Record<string, unknown>
): Promise<void> => {
  const workflowName = process.env.EZ4_WORKFLOW_NAME ?? 'workflow';
  const bucket = process.env.EZ4_WORKFLOW_BUCKET;
  if (!bucket) {
    throw new Error('EZ4_WORKFLOW_BUCKET is not set.');
  }
  const maxSteps = process.env.EZ4_WORKFLOW_MAX_STEPS ? parseInt(process.env.EZ4_WORKFLOW_MAX_STEPS, 10) : 10;

  const store = createWorkflowStore(bucket, workflowName);

  // The bundled context throws for an alias the workflow did not declare.
  const invoke: WorkflowInvoker = async (agent, input, options) => {
    const client = context[getWorkflowAgentContextName(agent)] as Agent.Client<Agent.Service<Agent.Input, Agent.Output>>;
    const { id } = await client.invoke(input as Agent.Input, options);
    return { id };
  };

  for (const record of event.Records) {
    const message = parseWorkflowMessage(record.body);
    await runWorkflowStep({
      workflow: workflowName,
      maxSteps,
      message,
      handler,
      store,
      invoke,
      newId: () => randomUUID(),
      now: () => new Date()
    });
  }
};
