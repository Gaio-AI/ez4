import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServiceEmulators } from '../emulator/service';
import type { EmulatorCorsHandler, EmulatorRequestEvent, EmulatorResponse } from '../emulator/types';
import type { ServeOptions } from '../types/options';

import { Logger, LogFormat, LogColor } from '@ez4/logger';

import { getIncomingService } from './incoming';
import { getServicesManifest } from '../manifest/service';

type ResponseCors = {
  headers: Record<string, string>;
  replace: boolean;
};

export const requestHandler = (request: IncomingMessage, stream: ServerResponse, emulators: ServiceEmulators, options: ServeOptions) => {
  const service = getIncomingService(emulators, request, options);

  Logger.log(`➡️  ${request.method} ${request.url}`);

  if (request.method === 'GET' && service?.request.path === `/${options.projectName}/manifest`) {
    return sendSuccessResponse(stream, request, getAnyOriginCors(request), {
      body: JSON.stringify(getServicesManifest(emulators, options)),
      status: 200
    });
  }

  if (!service?.emulator) {
    return sendErrorResponse(stream, request, getAnyOriginCors(request), 404, 'Service emulator not found.');
  }

  const { requestHandler, corsHandler, ...emulator } = service.emulator;

  const event = {
    ...service.request,
    method: request.method ?? 'GET'
  };

  const cors = corsHandler ? getEmulatorCors(corsHandler, event) : getAnyOriginCors(request);

  // The serve answers OPTIONS requests for the emulators without their own CORS answer.
  if (request.method === 'OPTIONS' && !corsHandler) {
    return sendSuccessResponse(stream, request, cors, { status: 204 });
  }

  if (!requestHandler) {
    return sendErrorResponse(stream, request, cors, 422, `Service '${emulator.name}' can't handle requests.`);
  }

  const buffer: Buffer[] = [];

  request.on('data', (chunk) => {
    buffer.push(chunk);
  });

  request.on('end', async () => {
    try {
      const payload = buffer.length ? Buffer.concat(buffer) : undefined;

      const response = await requestHandler({
        ...event,
        body: payload
      });

      if (!response) {
        sendSuccessResponse(stream, request, cors, { status: 204 });
      } else {
        sendSuccessResponse(stream, request, cors, response);
      }
    } catch (error) {
      if (error instanceof Error && error.stack) {
        Logger.error(`${emulator.type} [${emulator.name}] Internal server error\n${error.stack}`);
      } else {
        Logger.error(`${emulator.type} [${emulator.name}] ${error}`);
      }

      sendErrorResponse(stream, request, cors, 500, `${error}`);
    }
  });
};

const sendSuccessResponse = (
  stream: ServerResponse<IncomingMessage>,
  request: IncomingMessage,
  cors: ResponseCors,
  response: EmulatorResponse
) => {
  Logger.log(`⬅️  ${response.status} ${request.url ?? '/'}`);

  writeResponse(stream, cors, response);
};

const sendErrorResponse = (
  stream: ServerResponse<IncomingMessage>,
  request: IncomingMessage,
  cors: ResponseCors,
  status: number,
  message: string
) => {
  Logger.log(LogFormat.toColor(LogColor.Red, `⬅️  ${status} ${request.url ?? '/'}`));

  // Errors carry CORS headers too, or the browser hides their status behind a CORS failure.
  writeResponse(stream, cors, {
    status,
    headers: {
      ['Content-Type']: 'application/json'
    },
    body: JSON.stringify({
      type: 'error',
      message
    })
  });
};

const getEmulatorCors = (corsHandler: EmulatorCorsHandler, event: EmulatorRequestEvent): ResponseCors => {
  const headers = corsHandler(event);

  return {
    headers: headers ?? {},
    replace: !!headers
  };
};

// Any origin, method and headers, under the ones the response sets itself.
const getAnyOriginCors = (request: IncomingMessage): ResponseCors => {
  const responseOrigin = request.headers.origin;

  const cors: ResponseCors = {
    headers: {},
    replace: false
  };

  if (responseOrigin) {
    cors.headers['Access-Control-Allow-Origin'] = responseOrigin;
    cors.headers['Access-Control-Allow-Credentials'] = 'true';

    if (request.method !== 'OPTIONS') {
      return cors;
    }

    const responseMethod = request.headers['access-control-request-method'] ?? request.method;
    const responseHeaders = request.headers['access-control-request-headers'];

    if (responseHeaders) {
      cors.headers['Access-Control-Allow-Headers'] = responseHeaders;
    }

    cors.headers['Access-Control-Allow-Methods'] = responseMethod;
  }

  return cors;
};

const writeResponse = (stream: ServerResponse<IncomingMessage>, cors: ResponseCors, response: EmulatorResponse) => {
  const { status, headers, body } = response;

  for (const headerName in cors.headers) {
    stream.setHeader(headerName, cors.headers[headerName]);
  }

  stream.writeHead(status, {
    ...(cors.replace ? getHeadersWithoutCors(headers) : headers),
    ...(body && {
      ['Content-Length']: Buffer.byteLength(body).toString()
    })
  });

  if (body) {
    stream.write(body);
  }

  stream.end();
};

const getHeadersWithoutCors = (headers: Record<string, string> | undefined) => {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([headerName]) => !headerName.toLowerCase().startsWith('access-control-'))
  );
};
