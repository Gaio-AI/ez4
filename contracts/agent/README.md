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
import type { Agent, AgentPermission } from '@ez4/agent';

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
    grants: [{ permission: AgentPermission.LogsRead; resources: ['api-*'] }];
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

#### Permissions

`grants` give an agent read access to AWS resources by name, with one `AgentPermission` member each: `LogsRead` (log groups), `LambdaRead` (functions), `EcsRead` (clusters), `CloudFormationRead` (stacks) and `CodeArtifactRead` (package repositories). Names leave out the deploy prefix, which EZ4 adds as it does to every resource it names (`<prefix>-<project>-...`), and `*` matches anything: `api-*` reads `stg-api-*` in a `stg` deploy and `prd-api-*` in a `prd` one, including the log groups of the `api` project's functions. CodeArtifact repositories belong to the account, not the deploy, so `CodeArtifactRead` names them as `<domain>/<repository>` with no prefix.

`statements` allow any other IAM actions on full resource ARNs, for resources EZ4 does not name:

```ts
permissions: {
  grants: [
    { permission: AgentPermission.LogsRead; resources: ['api-*', 'billing-worker'] },
    { permission: AgentPermission.CodeArtifactRead; resources: ['acme/npm'] }
  ];
  statements: [{ actions: ['s3:GetObject']; resources: ['arn:aws:s3:::reports-bucket/*'] }];
};
```

The egress proxy lets the agent reach the endpoint of each granted service (`logs.<region>.amazonaws.com`, ...) and, for `CodeArtifactRead`, the npm endpoint of the domain (`<domain>-<account>.d.codeartifact.<region>.amazonaws.com`). A log group grant cannot hide group names: listing log groups is not scoped by IAM, reading their events is.

#### Egress

EZ4 allows on its own the hosts the agent's provider needs (for `claude`: `api.anthropic.com`, `claude.ai`, `claude.com`, `platform.claude.com` and `console.anthropic.com`), the hosts of its workspace repositories, the AWS endpoints of its permissions and the runtime's ECS and STS endpoints. `egress` lists only what the agent reaches beyond those, such as `registry.npmjs.org`; an agent that needs nothing else declares no `egress`.

#### Git workspaces

Declare HTTPS repositories on an agent to include them in its workspace metadata:

```ts
export declare class ReviewAgent extends Agent.Service<ReviewInput, ReviewOutput> {
  // Other required members omitted here.
  workspace: {
    repos: [{ url: 'https://github.com/acme/api.git' }, { url: 'https://github.com/acme/web.git'; name: 'frontend'; branch: 'develop' }];
    auth: { githubApp: 'acme/github-app' };
  };
}
```

Repository names default to the URL's last path segment without `.git`; branches default to `main`. Names must be unique. Authentication accepts either `{ githubApp: 'secret-name' }` or `{ token: 'secret-name:jsonKey' }`. A caller can pass `Agent.WorkspaceRef[]` through `invoke` options, and hooks receive the repository paths and base commits in `request.workspace`. The finish hook also receives `refs`, which appear on `Agent.Result.workspace`.

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

#### Agent workflows

Workflows orchestrate multi-step execution flows across autonomous agents. A workflow defines a strongly-typed input, persistent state, a set of agents, and a step handler:

```ts
import type { Agent } from '@ez4/agent';
import type { Service } from '@ez4/common';
import type { CodeReviewAgent } from './agent';

export interface WorkflowState {
  stepCount: number;
}

export declare class ReviewWorkflow extends Agent.Workflow<{ pullRequest: number }, WorkflowState, { review: CodeReviewAgent }> {
  input: { pullRequest: number };
  agents: { review: CodeReviewAgent };
  maxSteps: 5;
  handler: typeof reviewStep;
}

export function reviewStep(
  request: Agent.WorkflowRequest<ReviewWorkflow>,
  _context: Service.Context<ReviewWorkflow>
): Agent.WorkflowStep<WorkflowState, { review: CodeReviewAgent }> {
  if (request.event.type === 'start') {
    return {
      state: { stepCount: 0 },
      next: {
        invoke: 'review',
        input: { pullRequest: request.event.input.pullRequest }
      }
    };
  }

  // Handle agent completion result
  const { result } = request.event;
  return {
    state: { stepCount: (request.state?.stepCount ?? 0) + 1 },
    next: { complete: result.status }
  };
}
```

Connected services trigger workflows and inspect status through the generated `WorkflowClient`:

```ts
// Start a workflow run
const { runId } = await reviewWorkflow.start({ pullRequest: 42 });

// Check run status
const run = await reviewWorkflow.status(runId);
if (run?.status === 'completed') {
  console.log('Workflow outcome:', run.outcome, run.state);
}
```

Workflows enforce a configurable step limit (`maxSteps`, 1..100, default 10) to guard against unbounded execution loops. State transitions are saved atomically with optimistic locking.

## Providers

- [Local provider](../../providers/local/local-agent)
- [AWS provider](../../providers/aws/aws-agent)

## License

MIT License
