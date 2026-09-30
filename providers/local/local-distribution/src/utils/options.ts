import type { CdnService } from '@ez4/distribution/library';
import type { ServeOptions } from '@ez4/project/library';

import { toSnakeCase } from '@ez4/utils';

export const DEFAULT_VIEWER_COUNTRY = 'US';

export type DistributionLocalOptions = {
  viewerCountry?: string;
};

export const getLocalOptions = (service: CdnService, options: ServeOptions): DistributionLocalOptions => {
  const optionsName = toSnakeCase(service.name);

  return {
    ...options.localOptions[optionsName],
    ...(options.test && options.testOptions[optionsName])
  };
};
