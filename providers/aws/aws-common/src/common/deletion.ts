import type { StepContext } from '@ez4/state';

/**
 * Tells whether a resource that is only deleted with `--force` can be deleted now. When it can't, the step adds
 * a warning that names it, which keeps its entry in the state: a later run with `--force` still finds it, where
 * a silent skip would drop the entry and leave the resource in the account with nothing to delete it.
 */
export const allowForcedDeletion = (context: StepContext, kind: string, name: string) => {
  if (context.force) {
    return true;
  }

  context.addWarning(`${kind} '${name}' was kept; deleting it needs --force.`);

  return false;
};
