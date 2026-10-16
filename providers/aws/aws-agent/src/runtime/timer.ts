export interface AgentTimer {
  readonly signal: AbortSignal;
  dispose(): void;
}

export const createTimeoutTimer = (timeoutSeconds: number): AgentTimer => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error('Operation timed out'));
  }, timeoutSeconds * 1000);

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
    }
  };
};
