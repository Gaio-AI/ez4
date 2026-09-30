import type { EmulateServiceEvent } from '@ez4/project/library';

import { isCdnService, registerTriggers as registerDistributionTriggers } from '@ez4/distribution/library';
import { tryCreateTrigger } from '@ez4/project/library';

import { registerLocalService } from './local';

export const registerTriggers = () => {
  registerDistributionTriggers();

  tryCreateTrigger('@ez4/local-distribution', {
    'emulator:getServices': ({ service, options, context }: EmulateServiceEvent) => {
      if (isCdnService(service)) {
        return registerLocalService(service, options, context);
      }

      return null;
    }
  });
};
