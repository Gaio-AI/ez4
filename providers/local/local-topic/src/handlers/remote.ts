import type { AnyObject } from '@ez4/utils';
import type { TopicRemoteSubscription } from '../types/subscription';
import type { MessageTrace } from '@ez4/local-common';

import { getMessageTraceHeaders } from '@ez4/local-common';
import { Logger } from '@ez4/logger';

export const processRemoteEvent = async (subscription: TopicRemoteSubscription, event: AnyObject, trace: MessageTrace) => {
  const { resourceName, serviceHost } = subscription;

  try {
    const response = await fetch(serviceHost, {
      method: 'POST',
      body: JSON.stringify(event),
      headers: {
        ['content-type']: 'application/json',
        ...getMessageTraceHeaders(trace)
      }
    });

    if (!response.ok) {
      const { message } = await response.json();

      throw new Error(message);
    }
  } catch (error) {
    Logger.error(`Remote subscription [${resourceName}] at ${serviceHost} isn't available.`);
    Logger.error(`    ${error}`);
  }
};
