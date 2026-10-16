import { randomBytes, createHash } from 'node:crypto';

const CRYPT_ALPHABET = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const generateAgentPassword = (): string => {
  return randomBytes(32).toString('hex');
};

// MD5-crypt ($1$), the strongest scheme Squid's basic_ncsa_auth verifies through crypt(3); it has no {SHA} support.
export const md5Crypt = (password: string, salt: string): string => {
  const md5 = (...parts: (string | Buffer)[]) => parts.reduce((hash, part) => hash.update(part), createHash('md5')).digest();

  const alternate = md5(password, salt, password);
  const parts: (string | Buffer)[] = [password, '$1$', salt];

  for (let length = password.length; length > 0; length -= 16) {
    parts.push(alternate.subarray(0, Math.min(16, length)));
  }

  for (let length = password.length; length > 0; length >>= 1) {
    parts.push(length & 1 ? '\0' : password[0]);
  }

  let digest = md5(...parts);

  for (let round = 0; round < 1000; round++) {
    const step: (string | Buffer)[] = [round & 1 ? password : digest];

    if (round % 3) {
      step.push(salt);
    }

    if (round % 7) {
      step.push(password);
    }

    step.push(round & 1 ? digest : password);
    digest = md5(...step);
  }

  // Byte groups in the order crypt(3) emits them; the last group holds a single byte.
  const groups = [[0, 6, 12], [1, 7, 13], [2, 8, 14], [3, 9, 15], [4, 10, 5], [11]];

  let hash = '';

  for (const group of groups) {
    let value = group.reduce((total, index) => (total << 8) | digest[index], 0);

    for (let count = 0; count <= group.length; count++, value >>= 6) {
      hash += CRYPT_ALPHABET[value & 0x3f];
    }
  }

  return `$1$${salt}$${hash}`;
};

export const generateHtpasswd = (credentials: Record<string, string>): string => {
  const lines: string[] = [];

  for (const [user, password] of Object.entries(credentials)) {
    const salt = Array.from(randomBytes(8), (byte) => CRYPT_ALPHABET[byte & 0x3f]).join('');
    lines.push(`${user}:${md5Crypt(password, salt)}`);
  }

  return lines.join('\n') + '\n';
};
