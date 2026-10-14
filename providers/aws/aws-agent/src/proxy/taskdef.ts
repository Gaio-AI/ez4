import type { RegisterTaskDefinitionCommandInput } from '@aws-sdk/client-ecs';

export const PROXY_IMAGE = 'public.ecr.aws/ubuntu/squid:latest';

export const PROXY_PORT = 3128;

// Writes the generated config and the per-agent htpasswd lines (injected as secrets) before starting Squid in the foreground.
export const PROXY_START_SCRIPT = [
  'printf "%s" "$SQUID_CONF" > /etc/squid/squid.conf',
  "env | sed -n 's/^SQUID_HTPASSWD_[0-9]*=//p' > /etc/squid/passwords",
  'chmod 644 /etc/squid/passwords',
  'exec squid -N -f /etc/squid/squid.conf'
].join(' && ');

export type ProxyTaskDefinitionInput = {
  baseName: string;
  squidConfig: string;
  credentialSecretArns: string[];
  executionRoleArn: string;
  logGroupName: string;
  region: string;
};

export const buildProxyTaskDefinitionInput = (input: ProxyTaskDefinitionInput): RegisterTaskDefinitionCommandInput => ({
  family: `${input.baseName}-proxy`,
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '256',
  memory: '512',
  executionRoleArn: input.executionRoleArn,
  containerDefinitions: [
    {
      name: 'proxy',
      image: PROXY_IMAGE,
      essential: true,
      entryPoint: ['sh', '-c'],
      command: [PROXY_START_SCRIPT],
      portMappings: [{ containerPort: PROXY_PORT, protocol: 'tcp' }],
      environment: [{ name: 'SQUID_CONF', value: input.squidConfig }],
      secrets: input.credentialSecretArns.map((arn, index) => ({ name: `SQUID_HTPASSWD_${index}`, valueFrom: `${arn}:htpasswd::` })),
      logConfiguration: {
        logDriver: 'awslogs',
        options: { 'awslogs-group': input.logGroupName, 'awslogs-region': input.region, 'awslogs-stream-prefix': 'proxy' }
      }
    }
  ]
});
