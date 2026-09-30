export type TopicServiceSubscribeRequest = {
  serviceHost: string;
  resourceName: string;
};

export type TopicServiceUnsubscribeRequest = {
  resourceName: string;
};

// Specs run in the same process and may stub globalThis.fetch, so the emulator traffic keeps the native one.
const nativeFetch = globalThis.fetch;

export const subscribeToTopicService = (topicHost: string, request: TopicServiceSubscribeRequest) => {
  return sendTopicServiceRequest(`${topicHost}/subscribe`, JSON.stringify(request));
};

export const unsubscribeFromTopicService = (topicHost: string, request: TopicServiceUnsubscribeRequest) => {
  return sendTopicServiceRequest(`${topicHost}/unsubscribe`, JSON.stringify(request));
};

export const getTopicServiceHost = (serviceHost: string, topicIdentifier: string) => {
  return `http://${serviceHost}/${topicIdentifier}`;
};

export const sendTopicServiceRequest = async (serviceHost: string, request: string, headers?: Record<string, string>) => {
  const response = await nativeFetch(serviceHost, {
    method: 'POST',
    body: request,
    headers: {
      ['content-type']: 'application/json',
      ...headers
    }
  });

  if (!response.ok) {
    const { message } = await response.json();

    throw new Error(message);
  }
};
