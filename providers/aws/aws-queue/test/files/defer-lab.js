import { setTimeout } from 'node:timers/promises';

// Logs each run for the spec to read. A message not due yet is put off until it is, like a quota that resets at
// a known time; every other run takes a few seconds, so runs of the same key would overlap without a limit. Queue
// functions log at WARN by default, so the probe goes out as a warning.
export async function main(request) {
  const { message, attempt } = request;

  const startedAt = Date.now();

  if (message.notBefore && startedAt < message.notBefore) {
    console.warn(JSON.stringify({ probe: 'run', id: message.id, account: message.account, attempt, deferred: true, startedAt, endedAt: startedAt }));

    await request.defer({ delay: Math.ceil((message.notBefore - startedAt) / 1000) });

    return;
  }

  await setTimeout(3000);

  console.warn(JSON.stringify({ probe: 'run', id: message.id, account: message.account, attempt, deferred: false, startedAt, endedAt: Date.now() }));
}
