import type { ECSClient, RunTaskCommandInput } from '@aws-sdk/client-ecs';
import { DescribeTasksCommand, RunTaskCommand, StopTaskCommand } from '@aws-sdk/client-ecs';

export const runTask = async (client: ECSClient, input: RunTaskCommandInput) => {
  const response = await client.send(new RunTaskCommand(input));
  return { taskArn: response.tasks?.[0]?.taskArn, failures: response.failures ?? [] };
};

export const stopTask = async (client: ECSClient, cluster: string, taskArn: string, reason?: string) =>
  client.send(new StopTaskCommand({ cluster, task: taskArn, reason }));

export const describeTasks = async (client: ECSClient, cluster: string, taskArns: string[]) =>
  client.send(new DescribeTasksCommand({ cluster, tasks: taskArns }));
