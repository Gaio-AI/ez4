import type { ClientRequestInput } from '@ez4/gateway/utils';
import type { HttpClientResponse } from '@ez4/gateway';

import { prepareRequestBody, prepareResponseBody } from '@ez4/http';
import { getHttpException } from '@ez4/gateway/utils';

// Captured when the module loads, so a spec that stubs `globalThis.fetch` doesn't intercept the emulator traffic.
const emulatorFetch = globalThis.fetch;

// Same request and response handling as `sendClientRequest` from `@ez4/gateway/utils`, over the fetch above. It stays
// a copy because every deployed HTTP client bundles `sendClientRequest`, and a change there changes all of them.
export const sendEmulatorRequest = async (url: string, method: string, request: ClientRequestInput): Promise<HttpClientResponse> => {
  const { authorization, headers, body, bodySchema, responseSchema, namingStyle, timeout = 20 } = request;

  const payload = body ? prepareRequestBody(body, bodySchema, namingStyle) : undefined;

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort('Request timed out'), timeout * 1000);

  const result = await emulatorFetch(url, {
    signal: controller.signal,
    body: payload?.body,
    method,
    headers: {
      ...headers,
      ...(authorization && {
        [authorization.header]: authorization.value
      }),
      ...(payload?.json && {
        ['content-type']: 'application/json'
      })
    }
  });

  clearTimeout(timerId);

  if (!result.ok) {
    const error = await result.json();

    throw getHttpException(result.status, error.message, error.context);
  }

  const response = await result.text();

  return {
    status: result.status,
    headers: Object.fromEntries(result.headers.entries()),
    ...(response && {
      body: prepareResponseBody(response, responseSchema, namingStyle)
    })
  };
};
