// Each handler counts its runs on globalThis, where the spec reads them: the bundle is a module of its own.
const countRun = (handlerName) => {
  const runs = (globalThis.__deferRuns ??= {});

  runs[handlerName] = (runs[handlerName] ?? 0) + 1;
};

export async function deferHandler(request) {
  countRun('deferHandler');

  await request.defer({ delay: request.message.delay });
}

export async function deferThenFailHandler(request) {
  countRun('deferThenFailHandler');

  await request.defer({ delay: 60 });

  throw new Error('The handler failed after putting the message off.');
}

export function slotHandler() {
  countRun('slotHandler');
}

export function busySlotHandler() {
  countRun('busySlotHandler');
}
