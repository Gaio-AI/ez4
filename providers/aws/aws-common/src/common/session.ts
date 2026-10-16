import { GetSessionTokenCommand, STSClient } from '@aws-sdk/client-sts';

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { getAwsClientOptions } from '../utils/clients';

export type MfaSession = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
};

export type MfaSessionOptions = {
  serialNumber: string;
  durationSeconds?: number;
  askCode?: (serialNumber: string) => Promise<string>;
  stsClient?: Pick<STSClient, 'send'>;
};

const DEFAULT_DURATION_SECONDS = 12 * 60 * 60;

const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const getCacheDirectory = () => join(homedir(), '.ez4', 'mfa');

const getCacheFile = (serialNumber: string) => {
  const identity = `${serialNumber}:${process.env.AWS_ACCESS_KEY_ID ?? ''}`;

  return join(getCacheDirectory(), `${createHash('sha256').update(identity).digest('hex').slice(0, 16)}.json`);
};

const askCodeInTerminal = async (serialNumber: string) => {
  if (!process.stdin.isTTY) {
    throw new Error(`AWS_MFA_SERIAL is set, but there is no terminal to ask the MFA code of ${serialNumber}.`);
  }

  const terminal = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return await terminal.question(`MFA code for ${serialNumber}: `);
  } finally {
    terminal.close();
  }
};

export const openMfaSession = async (options: MfaSessionOptions): Promise<MfaSession> => {
  const { serialNumber, durationSeconds = DEFAULT_DURATION_SECONDS } = options;

  const { askCode = askCodeInTerminal, stsClient = new STSClient(getAwsClientOptions()) } = options;

  const tokenCode = (await askCode(serialNumber)).trim();

  const { Credentials } = await stsClient.send(
    new GetSessionTokenCommand({
      SerialNumber: serialNumber,
      TokenCode: tokenCode,
      DurationSeconds: durationSeconds
    })
  );

  if (!Credentials?.AccessKeyId || !Credentials.SecretAccessKey || !Credentials.SessionToken || !Credentials.Expiration) {
    throw new Error(`The MFA session of ${serialNumber} came back without credentials.`);
  }

  return {
    accessKeyId: Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretAccessKey,
    sessionToken: Credentials.SessionToken,
    expiration: Credentials.Expiration.toISOString()
  };
};

export const readCachedMfaSession = async (serialNumber: string, now = Date.now()): Promise<MfaSession | undefined> => {
  try {
    const session: MfaSession = JSON.parse(await readFile(getCacheFile(serialNumber), 'utf8'));

    if (Date.parse(session.expiration) - EXPIRY_MARGIN_MS > now) {
      return session;
    }
  } catch {
    // No cached session, or one that can't be read: a new one is asked for.
  }

  return undefined;
};

export const writeCachedMfaSession = async (serialNumber: string, session: MfaSession) => {
  await mkdir(getCacheDirectory(), { recursive: true, mode: 0o700 });

  await writeFile(getCacheFile(serialNumber), JSON.stringify(session), { mode: 0o600 });
};

export const applyMfaSession = (session: MfaSession) => {
  process.env.AWS_ACCESS_KEY_ID = session.accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = session.secretAccessKey;
  process.env.AWS_SESSION_TOKEN = session.sessionToken;
};

/**
 * Credentials that come from a temporary session carry `aws:MultiFactorAuthPresent`, which the access keys
 * alone don't. With `AWS_MFA_SERIAL` set, the long-lived keys in the environment are swapped for a session
 * opened with the MFA code, asked in the terminal and kept until it expires.
 */
export const prepareMfaSession = async () => {
  const serialNumber = process.env.AWS_MFA_SERIAL;

  if (!serialNumber || process.env.AWS_SESSION_TOKEN) {
    return;
  }

  let session = await readCachedMfaSession(serialNumber);

  if (!session) {
    session = await openMfaSession({ serialNumber });

    await writeCachedMfaSession(serialNumber, session);
  }

  applyMfaSession(session);
};
