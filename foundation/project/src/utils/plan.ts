import { Logger } from '@ez4/logger';

/**
 * Ends a `--plan` run that has changes. The exit code is the one of `terraform plan -detailed-exitcode`:
 * 0 without changes, 2 with changes and 1 on error.
 */
export const exitWithPlannedChanges = () => {
  Logger.log('ℹ️  Plan only, nothing was applied');

  process.exitCode = 2;
};
