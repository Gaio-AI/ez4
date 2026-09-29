import type { QueueImport, QueueService } from '@ez4/queue/library';
import type { AnyObject } from '@ez4/utils';

import { MissingMessageGroupError } from '@ez4/queue/utils';

export const getMessageGroupId = (message: AnyObject, service: QueueService | QueueImport) => {
  const groupId = service.fifoMode?.groupId ?? service.fairMode?.groupId;

  if (!groupId) {
    return undefined;
  }

  // The real client reads the group from the message as sent, before the schema transforms it.
  const groupValue = message[groupId];

  if (!groupValue) {
    throw new MissingMessageGroupError(groupId);
  }

  return `${groupValue}`;
};
