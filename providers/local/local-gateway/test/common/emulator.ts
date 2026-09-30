import type { EmulateServiceContext, EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';

export const serveOptions = {
  prefix: 'ez4',
  projectName: 'gateway',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {}
} as ServeOptions;

export const emulateContext = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

export const getRequest = (method: string, path: string, headers: Record<string, string> = {}): EmulatorRequestEvent => {
  return {
    method,
    path,
    headers,
    query: {}
  };
};

export const getHandler = (file: string, name: string) => {
  return {
    file: `test/fixtures/${file}`,
    position: [1, 1],
    name
  };
};
