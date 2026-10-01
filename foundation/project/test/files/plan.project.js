/**
 * @type {import('@ez4/project').ProjectOptions}
 */
export default {
  prefix: 'ez4',
  projectName: 'plan',
  sourceFiles: [],
  // Applies without asking, so only the plan mode itself can stop it before the apply.
  confirmMode: false,
  stateFile: {
    path: 'plan-state',
    remote: true
  }
};
