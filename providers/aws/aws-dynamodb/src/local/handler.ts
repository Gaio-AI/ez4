import type { EmulateServiceContext, EmulatorServiceClients, EntrypointModule, ServeOptions } from '@ez4/project/library';
import type { DatabaseService, DatabaseTable, TableStream } from '@ez4/database/library';
import type { _Record } from '@aws-sdk/client-dynamodb-streams';
import type { Database } from '@ez4/database';

import { Runtime, ServiceError, ServiceEventType } from '@ez4/common';
import { createEmulatorModule } from '@ez4/project/library';
import { getRandomUUID, isAnyArray, pickObject } from '@ez4/utils';
import { Logger } from '@ez4/logger';

import { getRecordChange } from './changes';

export type StreamHandlerContext = {
  service: DatabaseService;
  table: DatabaseTable;
  stream: TableStream;
  options: ServeOptions;
  context: EmulateServiceContext;
};

type StreamEvent = Database.ServiceEvent<Database.Schema>;

export const processStreamRecord = async (handlerContext: StreamHandlerContext, record: _Record) => {
  const { service, table, stream, options, context } = handlerContext;

  const servicesInUse = stream.handler.references ? pickObject(service.services, stream.handler.references) : service.services;
  const serviceClients = context.makeClients(servicesInUse);

  const variables = {
    ...options.variables,
    ...service.variables,
    ...stream.variables
  };

  const [handlerModule, listenerModule] = await Promise.all([
    createEmulatorModule({
      entrypoint: stream.handler,
      version: options.version,
      variables
    }),
    stream.listener &&
      createEmulatorModule({
        entrypoint: stream.listener,
        version: options.version,
        variables
      })
  ]);

  const dispatch = (event: StreamEvent) => {
    return listenerModule?.invoke(event, serviceClients);
  };

  await Runtime.runWithScope(() => {
    return runStreamHandler(table, record, handlerModule, serviceClients, dispatch);
  });
};

const runStreamHandler = async (
  table: DatabaseTable,
  record: _Record,
  handlerModule: EntrypointModule,
  serviceClients: EmulatorServiceClients,
  dispatch: (event: StreamEvent) => unknown
) => {
  let currentRequest: Database.Incoming<Database.Schema> | undefined;

  const request = {
    requestId: getRandomUUID()
  };

  try {
    await dispatch({
      type: ServiceEventType.Begin,
      request
    });

    const change = await getRecordChange(record, table.schema);

    if (!change) {
      return;
    }

    const traceId = getRandomUUID();

    currentRequest = {
      ...request,
      ...change,
      traceId
    };

    Runtime.setScope({
      traceId
    });

    await dispatch({
      type: ServiceEventType.Ready,
      request: currentRequest
    });

    await handlerModule.invoke(currentRequest, serviceClients);

    await dispatch({
      type: ServiceEventType.Done,
      request: currentRequest
    });
  } catch (error) {
    logStreamError(table, error);

    await dispatch({
      type: ServiceEventType.Error,
      request: currentRequest ?? request,
      error
    });
  } finally {
    await dispatch({
      type: ServiceEventType.End,
      request
    });
  }
};

const logStreamError = (table: DatabaseTable, error: unknown) => {
  Logger.error(`Stream handler of table [${table.name}] failed.`);

  if (error instanceof Error) {
    Logger.error(error.stack ?? error.message);
  } else {
    Logger.error(`${error}`);
  }

  if (error instanceof ServiceError && isAnyArray(error.context?.details)) {
    error.context.details.forEach((detail: string) => Logger.error(`\t${detail}`));
  }
};
