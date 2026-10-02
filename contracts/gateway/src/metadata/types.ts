import type { LinkedServices, LinkedVariables } from '@ez4/project/library';
import type { NamingStyle } from '@ez4/schema';

export type WebPreferences = {
  namingStyle?: NamingStyle;
  strictQueryStrings?: boolean;
};

export type WebProvider = {
  name: string;
  file?: string;
  variables?: LinkedVariables;
  services?: LinkedServices;
};
