import type { GetSessionTokenCommandInput } from '@aws-sdk/client-sts';

import { afterEach, beforeEach, describe, it } from 'node:test';
import { deepEqual, equal, rejects } from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openMfaSession, prepareMfaSession, readCachedMfaSession, writeCachedMfaSession } from '../src/common/session';

const SERIAL = 'arn:aws:iam::123456789012:mfa/someone';

const ENVIRONMENT_KEYS = ['HOME', 'AWS_MFA_SERIAL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'] as const;

const makeSession = (expiration: Date) => ({
  accessKeyId: 'ASIASESSION',
  secretAccessKey: 'session-secret',
  sessionToken: 'session-token',
  expiration: expiration.toISOString()
});

const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000);

describe('mfa session', () => {
  let savedEnvironment: Record<string, string | undefined>;
  let home: string;

  beforeEach(async () => {
    savedEnvironment = Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));

    home = await mkdtemp(join(tmpdir(), 'ez4-mfa-'));

    process.env.HOME = home;
    process.env.AWS_ACCESS_KEY_ID = 'AKIALONGLIVED';
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_MFA_SERIAL;
  });

  afterEach(async () => {
    for (const key of ENVIRONMENT_KEYS) {
      if (savedEnvironment[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnvironment[key];
      }
    }

    await rm(home, { recursive: true, force: true });
  });

  it('opens a session with the serial and the trimmed code', async () => {
    const sent: GetSessionTokenCommandInput[] = [];

    const session = await openMfaSession({
      serialNumber: SERIAL,
      askCode: async () => ' 123456\n',
      stsClient: {
        send: (async (command: { input: GetSessionTokenCommandInput }) => {
          sent.push(command.input);

          return {
            Credentials: {
              AccessKeyId: 'ASIASESSION',
              SecretAccessKey: 'session-secret',
              SessionToken: 'session-token',
              Expiration: new Date('2030-01-01T00:00:00Z')
            }
          };
        }) as never
      }
    });

    deepEqual(sent, [{ SerialNumber: SERIAL, TokenCode: '123456', DurationSeconds: 43200 }]);

    deepEqual(session, {
      accessKeyId: 'ASIASESSION',
      secretAccessKey: 'session-secret',
      sessionToken: 'session-token',
      expiration: '2030-01-01T00:00:00.000Z'
    });
  });

  it('rejects a session that comes back without credentials', async () => {
    await rejects(
      openMfaSession({
        serialNumber: SERIAL,
        askCode: async () => '123456',
        stsClient: { send: (async () => ({})) as never }
      }),
      { message: `The MFA session of ${SERIAL} came back without credentials.` }
    );
  });

  it('reads back a cached session until it is about to expire', async () => {
    const session = makeSession(inOneHour());

    await writeCachedMfaSession(SERIAL, session);

    deepEqual(await readCachedMfaSession(SERIAL), session);
    equal(await readCachedMfaSession(SERIAL, Date.now() + 56 * 60 * 1000), undefined);
  });

  it('keeps a cached session to the access key it was opened with', async () => {
    await writeCachedMfaSession(SERIAL, makeSession(inOneHour()));

    process.env.AWS_ACCESS_KEY_ID = 'AKIAOTHERKEY';

    equal(await readCachedMfaSession(SERIAL), undefined);
  });

  it('swaps the environment credentials for the cached session', async () => {
    const session = makeSession(inOneHour());

    await writeCachedMfaSession(SERIAL, session);

    process.env.AWS_MFA_SERIAL = SERIAL;

    await prepareMfaSession();

    equal(process.env.AWS_ACCESS_KEY_ID, session.accessKeyId);
    equal(process.env.AWS_SECRET_ACCESS_KEY, session.secretAccessKey);
    equal(process.env.AWS_SESSION_TOKEN, session.sessionToken);
  });

  it('leaves the credentials alone without a serial or with a session already in place', async () => {
    await writeCachedMfaSession(SERIAL, makeSession(inOneHour()));

    await prepareMfaSession();

    equal(process.env.AWS_ACCESS_KEY_ID, 'AKIALONGLIVED');

    process.env.AWS_MFA_SERIAL = SERIAL;
    process.env.AWS_SESSION_TOKEN = 'already-here';

    await prepareMfaSession();

    equal(process.env.AWS_ACCESS_KEY_ID, 'AKIALONGLIVED');
    equal(process.env.AWS_SESSION_TOKEN, 'already-here');
  });
});
