/**
 * Read access an agent can be granted to AWS resources, scoped by resource names.
 */
export const enum AgentPermission {
  /**
   * Read CloudWatch log groups: describe, get and filter events, run Logs Insights queries.
   */
  LogsRead = 'logs-read',

  /**
   * Read Lambda function aliases, versions, URL configs and policies.
   */
  LambdaRead = 'lambda-read',

  /**
   * Read ECS clusters, their tasks and task definitions.
   */
  EcsRead = 'ecs-read',

  /**
   * Read CloudFormation stacks, their events, resources and templates.
   */
  CloudFormationRead = 'cloudformation-read',

  /**
   * Install packages from CodeArtifact repositories: authorization token, repository endpoint and package reads.
   * Resources are `<domain>/<repository>`, which belong to the account, so they take no deploy prefix.
   */
  CodeArtifactRead = 'codeartifact-read'
}
