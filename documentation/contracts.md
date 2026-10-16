# EZ4: Contracts Overview

EZ4 uses TypeScript to define strongly‑typed **contracts** that declare your application's infrastructure. Instead of writing verbose IaC definitions for every cloud-based resource, you declare how they connect and what parameters they need. These contracts become the **single source of truth** for both your infrastructure and your application code.

## Connecting resources

Every contract dealing with handlers has support for a `services` property, which lets you declare dependencies on resources. At runtime, EZ4 automatically injects these connected resources into your function's context, allowing you to consume them as typed service clients.

```ts
export declare class AnotherResource extends Example.Service {
  // Resource parameters...
}

export declare class MainResource extends Example.Service {
  handler: typeof resourceHandler;

  services: {
    // From AnotherResource, provide a service consumer.
    anotherService: Environment.Service<AnotherResource>;
  };
}

export function resourceHandler({ anotherService }: Service.Context<MainResource>) {
  // Use the provided resource service.
  anotherService.dummyMethod();
}
```

> This pattern keeps your infrastructure relationships explicit, type‑safe, and easy to reason about.

When bundling `resourceHandler`, EZ4 reflects over the contract's type declarations to resolve all connected resources and generate the corresponding service clients. These clients are embedded into the bundle and later injected at runtime through the handler context (Prefer destructuring contexts to inject only the necessary dependencies). Since the implementations are produced from the contract metadata, no concrete classes exist for the contract types.

### Context resolution at runtime

Service context is resolved lazily at runtime. Accessing a context key that was not declared in `services` throws an error. Keep handlers explicit by destructuring only the dependencies they actually need, as this can reduce bundle size and cold starts.

## Environment variables

Contracts that define a handler can also declare **environment variables** using the `variables` property, making configuration explicit and type‑safe at the TypeScript level. During metadata build (including deploy and serve flows), EZ4 resolves each declared variable: `Environment.Variable<'NAME'>` must resolve to a non-empty value, while `Environment.VariableOrValue<'NAME', Default>` falls back to its default when the environment variable is missing. At runtime, variables exposed through `Environment.ServiceVariables` are injected as strings.

```ts
export declare class MainResource extends Example.Service {
  handler: typeof resourceHandler;

  variables: {
    myVariable1: Environment.Variable<'SERVICE_VARIABLE_1'>;
    myVariable2: Environment.VariableOrValue<'SERVICE_VARIABLE_2', 'default value'>;
    myVariable3: 'literal value';
  };

  services: {
    // Expose the declared environment variables as a service
    variables: Environment.ServiceVariables;
  };
}

export function resourceHandler({ variables }: Service.Context<MainResource>) {
  // Use the injected environment variables.
  variables.myVariable1;
  variables.myVariable2;
  variables.myVariable3;
}
```

This keeps configuration explicit and discoverable while avoiding unnecessary runtime overhead. TypeScript ensures correctness during development, and EZ4 resolves and validates variables during metadata build.

### Linked service variable collisions

When linked services expose variables into the same target context, variable aliases must be consistent. If two linked services provide the same alias with different values, metadata build fails. Use unique aliases across linked service graphs to avoid collisions.

## Circular linked services

Circular linked services are supported. EZ4 resolves linked contexts lazily and caches intermediate linked contexts while preparing metadata. Prefer small constructors and avoid heavy side effects during service initialization when using circular dependencies.

## All contracts

- [Agent](../contracts/agent/README.md)
- [Gateway](../contracts/gateway/README.md)
- [Database](../contracts/database/README.md)
- [Cache](../contracts/cache/README.md)
- [Scheduler](../contracts/scheduler/README.md)
- [Storage](../contracts/storage/README.md)
- [Topic](../contracts/topic/README.md)
- [Queue](../contracts/queue/README.md)
- [Distribution](../contracts/distribution/README.md)
- [Email](../contracts/email/README.md)
- [Validation](../contracts/validation/README.md)
- [Factory](../contracts/factory/README.md)

## Agent

The Agent contract allows declaring autonomous LLM-powered services running on AWS ECS Fargate with dedicated IAM isolation, domain egress restrictions, shared git workspaces, and multi-agent workflow orchestration.

### Service Definition

```typescript
import type { Environment } from '@ez4/common';
import { Agent, AgentPermission, AgentProvider, AgentToolsMode, WorkflowEventType } from '@ez4/agent';

export declare class CodeReviewAgent extends Agent.Service<ReviewInput, ReviewOutput> {
  provider: AgentProvider.Claude;
  model: 'claude-sonnet-4-5';
  instructions: 'You are an autonomous code reviewer.';
  tools: {
    mode: AgentToolsMode.Readonly;
    allowed: ['Read', 'Grep', 'Glob'];
  };
  workspace: {
    repos: [{ url: 'https://github.com/acme/project.git' }];
    auth: {
      githubApp: {
        appId: Environment.Variable<'GITHUB_APP_ID'>;
        installationId: Environment.Variable<'GITHUB_APP_INSTALLATION_ID'>;
        privateKey: Environment.Variable<'GITHUB_APP_PRIVATE_KEY'>;
      };
    };
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
}
```

### Git Workspaces

Agents can declare a `workspace` containing one or more HTTPS git repositories with GitHub App or personal access token credentials. Repositories are cached as bare clones on shared Amazon EFS storage and mounted at `/mnt/ez4-workspace`. Changes between agent invocations are tracked and handed off via custom git refs (`refs/ez4/<agent>/<invocationId>`).

### Workflows

Multi-step agent collaboration is declared using `Agent.Workflow`. Workflows coordinate step-by-step executions across multiple agents with persistent state, step caps (`maxSteps`, 1..100, default 10), and start/result event processing:

```typescript
export declare class ReviewWorkflow extends Agent.Workflow<{ pullRequest: number }, { status: string }, { review: CodeReviewAgent }> {
  input: { pullRequest: number };
  state: { status: string };
  agents: { review: CodeReviewAgent };
  maxSteps: 5;
  handler: typeof reviewStep;
}

export function reviewStep(
  request: Agent.WorkflowRequest<ReviewWorkflow>
): Agent.WorkflowStep<{ status: string }, { review: CodeReviewAgent }> {
  if (request.event.type === WorkflowEventType.Start) {
    return {
      state: { status: 'reviewing' },
      next: { invoke: 'review', input: { pullRequest: request.event.input.pullRequest } }
    };
  }
  return {
    state: { status: 'done' },
    next: { complete: request.event.result.status }
  };
}
```

### Client Invocation

Connected handlers can trigger individual agents or multi-step workflows:

```typescript
// Single agent invocation
const { id } = await context.services.CodeReviewAgent.invoke({ pullRequest: 42 }, { correlation: JSON.stringify({ reviewId: 'rev-1' }) });

// Workflow orchestration
const { runId } = await context.services.ReviewWorkflow.start({ pullRequest: 42 });
const run = await context.services.ReviewWorkflow.status(runId);
```

### Provider Architecture

Agent infrastructure deployment is split across focused provider packages:

- `@ez4/aws-agent`: Core Fargate execution provider, runtime entrypoint, egress proxy, and workflow runner.
- `@ez4/local-agent`: Local development emulator stub.
- `@ez4/aws-ecr`: ECR repository provisioning and Docker buildx image builds.
- `@ez4/aws-ecs`: ECS Fargate cluster, task definition, and service management.
- `@ez4/aws-efs`: Amazon EFS file system, mount targets, and access points for shared git workspaces.
- `@ez4/aws-cloudmap`: Private DNS service discovery namespace for egress proxy routing.
- `@ez4/aws-events`: EventBridge lifecycle rules and scheduled sweep dispatchers.
- `@ez4/aws-secret`: Secrets Manager integration for provider and proxy credentials.
- `@ez4/aws-vpc`: VPC subnet and security group tag discovery.

## What's next

- [Quick start](./quick-start.md)
- [Architecture overview](./architecture.md)
- [Philosophy](./philosophy.md)

## License

MIT License
