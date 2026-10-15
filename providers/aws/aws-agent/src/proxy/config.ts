import type { Agent } from '@ez4/agent';
import type { SquidConfigOptions } from './types';
import type { AgentService } from '@ez4/agent/library';

export interface AgentDomainInput {
  domains?: string[];
  egress?: string[];
  presets?: Agent.Preset[];
  statements?: Agent.Statement[];
  permissions?: Agent.Permissions;
}

const PRESET_SERVICE_MAP: Record<string, string> = {
  'logs-read': 'logs',
  'ecs-read': 'ecs',
  'lambda-read': 'lambda',
  'cloudformation-read': 'cloudformation'
};

export const normalizeDomain = (domain: string): string => {
  const trimmed = domain.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    throw new Error(`Domain must not include protocol: ${trimmed}`);
  }
  if (trimmed.includes('/') || trimmed.includes(':')) {
    throw new Error(`Invalid domain format: ${trimmed}`);
  }
  if (trimmed.startsWith('*.')) {
    return trimmed.slice(1);
  }
  return trimmed;
};

export const resolveAgentAllowedDomains = (agent: AgentDomainInput, region: string): string[] => {
  const domains = new Set<string>();

  const declared = [...(agent.domains ?? []), ...(agent.egress ?? [])];
  for (const domain of declared) {
    domains.add(normalizeDomain(domain));
  }

  const presets = [...(agent.presets ?? []), ...(agent.permissions?.presets ?? [])];
  for (const preset of presets) {
    const service = PRESET_SERVICE_MAP[preset];
    if (service) {
      domains.add(`${service}.${region}.amazonaws.com`);
    }
  }

  const statements = [...(agent.statements ?? []), ...(agent.permissions?.statements ?? [])];
  for (const statement of statements) {
    for (const action of statement.actions ?? []) {
      const [servicePrefix] = action.split(':');
      if (servicePrefix && servicePrefix !== '*' && servicePrefix.toLowerCase() !== 's3') {
        domains.add(`${servicePrefix.toLowerCase()}.${region}.amazonaws.com`);
      }
    }
  }

  return Array.from(domains).sort();
};
const PROVIDER_DOMAINS: Record<string, string[]> = { claude: ['api.anthropic.com'] };

/** Domains an agent may reach through the proxy: runtime AWS APIs, declared egress, permissions, and its LLM provider. */
export const getAgentEgressDomains = (agent: Pick<AgentService, 'egress' | 'permissions' | 'provider'>, region: string): string[] => {
  const domains = new Set(resolveAgentAllowedDomains({ egress: agent.egress, permissions: agent.permissions }, region));
  domains.add(`ecs.${region}.amazonaws.com`);
  domains.add(`sts.${region}.amazonaws.com`);
  domains.add('sts.amazonaws.com');
  for (const domain of PROVIDER_DOMAINS[agent.provider ?? ''] ?? []) domains.add(domain);
  return Array.from(domains).sort();
};

export const buildNoProxyList = (region: string): string[] => {
  return [
    'localhost',
    '127.0.0.1',
    '169.254.169.254',
    '169.254.170.2',
    `s3.${region}.amazonaws.com`,
    `.s3.${region}.amazonaws.com`,
    `logs.${region}.amazonaws.com`,
    `secretsmanager.${region}.amazonaws.com`,
    `api.ecr.${region}.amazonaws.com`,
    `dkr.ecr.${region}.amazonaws.com`,
    `.${region}.vpce.amazonaws.com`
  ];
};

export const generateSquidConfig = (options: SquidConfigOptions): string => {
  const { port = 3128, agents } = options;
  const lines: string[] = [
    `http_port ${port}`,
    'auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwords',
    'auth_param basic realm EZ4 Agent Egress Gateway',
    'acl auth_users proxy_auth REQUIRED',
    'acl SSL_ports port 443',
    'acl Safe_ports port 80',
    'acl Safe_ports port 443',
    'http_access deny !Safe_ports',
    'http_access deny CONNECT !SSL_ports'
  ];

  for (const agent of agents) {
    if (!agent.allowedDomains || agent.allowedDomains.length === 0) {
      continue;
    }
    const userAcl = `user_${agent.agentName}`;
    const domainAcl = `domains_${agent.agentName}`;
    const normalizedDomains = agent.allowedDomains.map(normalizeDomain);
    lines.push(`acl ${userAcl} proxy_auth ${agent.agentName}`);
    lines.push(`acl ${domainAcl} dstdomain ${normalizedDomains.join(' ')}`);
    lines.push(`http_access allow ${userAcl} ${domainAcl}`);
  }

  lines.push('http_access deny all');
  lines.push('coredump_dir /var/spool/squid');
  lines.push('cache deny all');
  lines.push('access_log stdio:/proc/self/fd/1');
  return lines.join('\n') + '\n';
};
