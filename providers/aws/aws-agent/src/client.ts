import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { validate, getErrorDetails } from '@ez4/validator';
import type { ObjectSchema } from '@ez4/schema';
import type { Agent } from '@ez4/agent';

export interface ClientParameters {
  agentName: string;
  cluster: string;
  taskDefinition: string;
  bucket: string;
  subnets: string[];
  securityGroups: string[];
  replyTo?: string;
  inputSchema: ObjectSchema;
  s3Client?: S3Client;
  ecsClient?: ECSClient;
}

export namespace Client {
  export const make = <S extends Agent.Service<any, any>>(parameters: ClientParameters): Agent.Client<S> => {
    const s3 = parameters.s3Client ?? new S3Client();
    const ecs = parameters.ecsClient ?? new ECSClient();

    return {
      async invoke(input: Agent.InputOf<S>, options?: Agent.InvokeOptions): Promise<{ id: string }> {
        const errors = await validate(input, parameters.inputSchema);
        if (errors && errors.length > 0) {
          throw new Error(`Agent input validation failed: ${JSON.stringify(getErrorDetails(errors))}`);
        }

        const id = randomUUID();
        const invocationPayload = {
          input,
          correlation: options?.correlation,
          replyTo: parameters.replyTo
        };

        await s3.send(
          new PutObjectCommand({
            Bucket: parameters.bucket,
            Key: `invocations/${parameters.agentName}/${id}.json`,
            Body: Buffer.from(JSON.stringify(invocationPayload), 'utf-8'),
            ContentType: 'application/json'
          })
        );

        await ecs.send(
          new RunTaskCommand({
            cluster: parameters.cluster,
            taskDefinition: parameters.taskDefinition,
            launchType: 'FARGATE',
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: parameters.subnets,
                securityGroups: parameters.securityGroups,
                assignPublicIp: 'DISABLED'
              }
            },
            overrides: {
              containerOverrides: [
                {
                  name: parameters.agentName,
                  environment: [
                    { name: 'EZ4_AGENT_ID', value: id },
                    { name: 'EZ4_AGENT_NAME', value: parameters.agentName }
                  ]
                }
              ]
            },
            tags: [
              { key: 'ez4:agent', value: parameters.agentName },
              { key: 'ez4:invocation-id', value: id }
            ]
          })
        );

        return { id };
      },

      async result(id: string): Promise<Agent.Result<S> | undefined> {
        try {
          const res = await s3.send(
            new GetObjectCommand({
              Bucket: parameters.bucket,
              Key: `results/${parameters.agentName}/${id}.json`
            })
          );
          const stream = res.Body as Readable;
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Agent.Result<S>;
        } catch (err: unknown) {
          const anyErr = err as { name?: string; $metadata?: { httpStatusCode?: number } };
          if (anyErr?.name === 'NoSuchKey' || anyErr?.$metadata?.httpStatusCode === 404) {
            return undefined;
          }
          throw err;
        }
      }
    };
  };
}
