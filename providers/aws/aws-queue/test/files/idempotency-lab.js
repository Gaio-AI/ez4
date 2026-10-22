// Logs each run for the spec to count, and fails as the message asks. Queue functions log at WARN by default, so
// the probe goes out as a warning.
export async function main(request) {
  const { message, attempt } = request;

  console.warn(JSON.stringify({ probe: 'run', id: message.id, attempt, at: Date.now() }));

  if (message.mode === 'fail-once' && attempt === 1) {
    throw new Error('lab: the provider failed');
  }

  if (message.mode === 'unknown') {
    const error = new Error('lab: the request timed out after it was sent');

    error.name = 'UnknownOutcomeError';

    throw error;
  }
}
