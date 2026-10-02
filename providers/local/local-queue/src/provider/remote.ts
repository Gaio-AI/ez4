import type { EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { QueueImport } from '@ez4/queue/library';
import type { QueueForwarder } from '../client/remote';

import { getServiceName, MissingImportedProjectError, UnsupportedDisabledImportError } from '@ez4/project/library';
import { getErrorResponse, getMessageTraceFromHeaders } from '@ez4/local-common';
import { MalformedMessageError, MissingMessageGroupError } from '@ez4/queue/utils';
import { getRandomUUID } from '@ez4/utils';
import { Runtime } from '@ez4/common';

import { createQueueForwarder, createRemoteClient } from '../client/remote';
import { getMessageDelayFromHeaders } from '../utils/message';
import { InvalidParameterValueError } from '../utils/errors';

export const registerRemoteService = (service: QueueImport, options: ServeOptions) => {
  const { name: resourceName, reference: referenceName, project } = service;
  const { imports } = options;

  if (!imports || !imports[project]) {
    throw new MissingImportedProjectError(project);
  }

  if (imports[project].disabled) {
    throw new UnsupportedDisabledImportError(resourceName, project);
  }

  const forwarder = createQueueForwarder(referenceName, imports[project]);

  return {
    type: 'Queue',
    name: resourceName,
    identifier: getServiceName(resourceName, options),
    exportHandler: () => {
      return createRemoteClient(service, forwarder);
    },
    requestHandler: (request: EmulatorRequestEvent) => {
      return handleQueueForward(service, forwarder, request);
    },
    shutdownHandler: () => {
      forwarder.stop();
    }
  };
};

const handleQueueForward = async (service: QueueImport, forwarder: QueueForwarder, request: EmulatorRequestEvent) => {
  const { traceId = getRandomUUID(), scope } = getMessageTraceFromHeaders(request.headers);

  const client = createRemoteClient(service, forwarder);
  const delay = getMessageDelayFromHeaders(request.headers);

  try {
    // Each forward imports the incoming scope into a scope of its own, which sendMessage captures right away.
    await Runtime.runWithScope(() => {
      Runtime.importScope(traceId, scope);

      return client.sendMessage(JSON.parse(request.body!.toString()), { delay });
    });

    return undefined;
    //
  } catch (error) {
    if (error instanceof MalformedMessageError) {
      return getErrorResponse(400, {
        message: error.message,
        context: error.context
      });
    }

    if (error instanceof MissingMessageGroupError || error instanceof InvalidParameterValueError) {
      return getErrorResponse(400, {
        message: error.message
      });
    }

    throw error;
  }
};
