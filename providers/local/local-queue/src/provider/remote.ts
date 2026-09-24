import type { EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { QueueImport } from '@ez4/queue/library';
import type { RemoteClientOptions } from '../client/remote';

import { getServiceName, MissingImportedProjectError } from '@ez4/project/library';
import { getMessageTraceFromHeaders } from '@ez4/local-common';
import { getRandomUUID } from '@ez4/utils';
import { Runtime } from '@ez4/common';

import { createRemoteClient } from '../client/remote';

export const registerRemoteService = (service: QueueImport, options: ServeOptions) => {
  const { name: resourceName, reference: referenceName, schema: messageSchema, project } = service;
  const { imports } = options;

  if (!imports || !imports[project]) {
    throw new MissingImportedProjectError(project);
  }

  const clientOptions = {
    ...imports[project]
  };

  return {
    type: 'Queue',
    name: resourceName,
    identifier: getServiceName(resourceName, options),
    exportHandler: () => {
      return createRemoteClient(referenceName, messageSchema, clientOptions);
    },
    requestHandler: (request: EmulatorRequestEvent) => {
      return handleQueueForward(service, clientOptions, request);
    }
  };
};

const handleQueueForward = (service: QueueImport, options: RemoteClientOptions, request: EmulatorRequestEvent) => {
  const { reference: referenceName, schema: messageSchema } = service;
  const { traceId = getRandomUUID(), scope } = getMessageTraceFromHeaders(request.headers);

  const client = createRemoteClient(referenceName, messageSchema, options);

  // sendMessage captures the runtime scope synchronously, so it must be imported right before the call.
  Runtime.importScope(traceId, scope);

  return client.sendMessage(JSON.parse(request.body!.toString()));
};
