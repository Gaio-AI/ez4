export type TimeoutProbe = {
  events: string[];
  started: (release: (response: unknown) => void) => void;
};

type ListenerEvent = {
  type: string;
};

declare global {
  var timeoutProbe: TimeoutProbe | undefined;
}

export const recordEvent = (event: ListenerEvent) => {
  globalThis.timeoutProbe?.events.push(event.type);
};

export const recordHandler = () => {
  globalThis.timeoutProbe?.events.push('handler');

  return {
    status: 204
  };
};

// Runs until the test releases it, as a handler past its Lambda timeout.
export const hangRequest = () => {
  return new Promise((resolve) => {
    globalThis.timeoutProbe?.started(resolve);
  });
};
