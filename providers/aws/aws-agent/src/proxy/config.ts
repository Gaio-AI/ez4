import { AgentProvider } from '@ez4/agent';
import type { Agent } from '@ez4/agent';
import type { SquidConfigOptions } from './types';
import type { AgentService } from '@ez4/agent/library';
import { getGrantDomains } from '../role/permissions';
import { getWorkspaceDomains } from '../workspace/resources';

export interface AgentDomainInput {
  egress?: string[];
  permissions?: Agent.Permissions;
}

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

export const resolveAgentAllowedDomains = (agent: AgentDomainInput, region: string, accountId: string): string[] => {
  const domains = new Set<string>();

  for (const domain of agent.egress ?? []) {
    domains.add(normalizeDomain(domain));
  }

  for (const grant of agent.permissions?.grants ?? []) {
    for (const domain of getGrantDomains(grant, region, accountId)) {
      domains.add(domain);
    }
  }

  for (const statement of agent.permissions?.statements ?? []) {
    for (const action of statement.actions) {
      const [servicePrefix] = action.split(':');
      if (servicePrefix && servicePrefix !== '*' && servicePrefix.toLowerCase() !== 's3') {
        domains.add(`${servicePrefix.toLowerCase()}.${region}.amazonaws.com`);
      }
    }
  }

  return Array.from(domains).sort();
};

/**
 * Hosts the provider CLI reaches with its OAuth token: the model API plus the account and token endpoints.
 */
export const PROVIDER_DOMAINS: Record<AgentProvider, string[]> = {
  [AgentProvider.Claude]: ['api.anthropic.com', 'claude.ai', 'claude.com', 'platform.claude.com', 'console.anthropic.com']
};

/** Domains an agent may reach through the proxy: its provider, workspace hosts, permissions, runtime AWS APIs and declared egress. */
export const getAgentEgressDomains = (
  agent: Pick<AgentService, 'egress' | 'permissions' | 'provider' | 'workspace'>,
  region: string,
  accountId: string
): string[] => {
  const domains = new Set(resolveAgentAllowedDomains({ egress: agent.egress, permissions: agent.permissions }, region, accountId));
  domains.add(`ecs.${region}.amazonaws.com`);
  domains.add(`sts.${region}.amazonaws.com`);
  domains.add('sts.amazonaws.com');
  for (const domain of agent.provider ? PROVIDER_DOMAINS[agent.provider] : []) domains.add(domain);
  if (agent.workspace) {
    for (const domain of getWorkspaceDomains(agent.workspace)) {
      domains.add(domain);
    }
  }
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

// The proxy image runs Squid as a non-root user, so the generated files live under /tmp.
export const PROXY_PASSWORDS_FILE = '/tmp/squid-passwords';

export const generateSquidConfig = (options: SquidConfigOptions): string => {
  const { port = 3128, agents } = options;
  const lines: string[] = [
    `http_port ${port}`,
    `auth_param basic program /usr/lib/squid/basic_ncsa_auth ${PROXY_PASSWORDS_FILE}`,
    'auth_param basic realm EZ4 Agent Egress Gateway',
    // Squid lowercases user names by default, which no longer match the agent names in the password file.
    'auth_param basic casesensitive on',
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
