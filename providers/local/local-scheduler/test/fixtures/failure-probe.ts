declare global {
  var observeFailure: (() => void) | undefined;
}

export const failProbe = () => {
  globalThis.observeFailure?.();

  throw new Error('Probe failure.');
};
