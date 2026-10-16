import type { IdentityEvent } from '@ez4/project/library';
import { ServiceType } from '@ez4/agent/library';

export const prepareIdentityAccount = (event: IdentityEvent) => {
  const { serviceType } = event;

  if (serviceType !== ServiceType) {
    return null;
  }

  return [
    {
      account: 'ecs-tasks.amazonaws.com'
    }
  ];
};
