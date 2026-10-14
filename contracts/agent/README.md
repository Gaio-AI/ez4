# EZ4: Agent

The Agent contract defines autonomous LLM-powered services running on AWS ECS Fargate with dedicated IAM isolation, domain egress restrictions, and async agent-to-agent callbacks. It uses EZ4's [reflection](../../foundation/reflection/) system to analyze your input/output schemas, prompt instructions, tool permissions, and connected services, generating the infrastructure and runtime bindings required to execute tasks.

## Getting started

#### Install

```sh
npm install @ez4/agent @ez4/local-agent @ez4/aws-agent -D
```

#### Create an agent service

Agents run isolated containerized workloads driven by an LLM provider (such as Claude).

```ts
import type { Service } from '@ez4/common';
import type { Agent } from '@ez4/agent';

export interface ReviewInput {
  pullRequest: number;
}

export interface ReviewOutput {
  approved: boolean;
  comments: string[];
}

export declare class CodeReviewAgent extends Agent.Service<ReviewInput, ReviewOutput> {
  provider: 'claude';
  model: 'claude-sonnet-4-5';
  instructions: 'You are an autonomous code reviewer.';

  input: ReviewInput;
  output: ReviewOutput;

  tools: {
    mode: 'readonly';
    allowed: ['Read', 'Grep', 'Glob'];
  };

  egress: ['api.github.com'];

  permissions: {
    presets: ['logs-read'];
  };

  resources: {
    cpu: 1024;
    memory: 2048;
    timeout: 3600;
  };

  prepare: typeof prepareReview;
  finish: typeof finishReview;
}
```

#### Lifecycle hooks

Agents support optional `prepare` and `finish` hooks for workspace initialization, prompt formatting, and result shaping:

```ts
import type { Agent } from '@ez4/agent';
import type { Service } from '@ez4/common';
import type { CodeReviewAgent, ReviewInput, ReviewOutput } from './agent';

export async function prepareReview(
  request: Agent.PrepareRequest<ReviewInput>,
  _context: Service.Context<CodeReviewAgent>
): Promise<Agent.PrepareResult> {
  const { id, input, workdir, artifacts } = request;

  // Store initial artifacts or write local files into workdir
  await artifacts.put('pr-metadata.json', JSON.stringify({ pr: input.pullRequest }));

  return {
    prompt: `Review pull request #${input.pullRequest}. Analyze changes and identify issues.`,
    workdir
  };
}

export async function finishReview(
  request: Agent.FinishRequest<ReviewInput, ReviewOutput>,
  _context: Service.Context<CodeReviewAgent>
): Promise<ReviewOutput> {
  const { output } = request;
  return output;
}
```

#### Invoke an agent

Connected handlers can trigger agent invocations using the generated client:

```ts
import type { Service } from '@ez4/common';
import type { CodeReviewAgent } from './agent';

export async function triggerReview(_request: any, { codeReviewAgent }: Service.Context<AnotherService>) {
  // Asynchronously launch agent task
  const { id } = await codeReviewAgent.invoke({ pullRequest: 42 }, { correlation: JSON.stringify({ reviewId: 'rev-1' }) });

  // Poll or check execution result
  const result = await codeReviewAgent.result(id);
  if (result?.status === 'succeeded') {
    console.log('Review completed:', result.output);
  }
}
```

#### Asynchronous callback queue

Agents can report completion results back to a caller FIFO queue by declaring `replyTo`:

```ts
export declare class CallerService extends Example.Service {
  services: {
    codeReviewAgent: Environment.Service<CodeReviewAgent, { replyTo: 'ResultsQueue' }>;
  };
}
```

When execution completes (or fails/times out), the dispatcher delivers the agent's result to the target queue with `MessageGroupId = agentName` and `MessageDeduplicationId = id`.

## Providers

- [Local provider](../../providers/local/local-agent)
- [AWS provider](../../providers/aws/aws-agent)

## License

MIT License
