// Each handler counts its runs on globalThis, where the spec reads them: the bundle is a module of its own.
const countRun = (handlerName) => {
  const runs = (globalThis.__idempotencyRuns ??= {});

  runs[handlerName] = (runs[handlerName] ?? 0) + 1;
};

export function onceHandler() {
  countRun('onceHandler');
}

export function batchOnceHandler() {
  countRun('batchOnceHandler');
}

export function busyHandler() {
  countRun('busyHandler');
}

export function expiredHandler() {
  countRun('expiredHandler');
}

export function failingHandler() {
  countRun('failingHandler');

  throw new Error('The provider failed.');
}

export function unknownHandler() {
  countRun('unknownHandler');

  const error = new Error('The request timed out after it was sent.');

  error.name = 'UnknownOutcomeError';

  throw error;
}

export async function retryHandler(request) {
  countRun('retryHandler');

  await request.retry();
}

export function plainHandler() {
  countRun('plainHandler');
}
