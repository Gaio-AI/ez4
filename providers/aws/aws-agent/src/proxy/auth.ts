import { randomBytes, createHash } from 'node:crypto';

export const generateAgentPassword = (): string => {
  return randomBytes(32).toString('hex');
};

export const generateHtpasswd = (credentials: Record<string, string>): string => {
  const lines: string[] = [];
  for (const [user, password] of Object.entries(credentials)) {
    // SHA-1 htpasswd format {SHA}base64(sha1(raw)) compatible with Squid basic_ncsa_auth
    const hash = createHash('sha1').update(password).digest('base64');
    lines.push(`${user}:{SHA}${hash}`);
  }
  return lines.join('\n') + '\n';
};
