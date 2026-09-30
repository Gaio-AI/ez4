declare global {
  var probeFailure: (() => boolean) | undefined;
}

export const failureProbe = () => {
  if (globalThis.probeFailure?.()) {
    throw new Error('Probe failure.');
  }
};
