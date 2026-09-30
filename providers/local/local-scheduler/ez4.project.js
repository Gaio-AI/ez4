/**
 * @type {import('@ez4/project').ProjectOptions}
 */
export default {
  prefix: 'ez4',
  projectName: 'local-scheduler',
  sourceFiles: ['./test/fixtures/reports.ts'],
  customProviders: {
    packages: ['@ez4/local-scheduler']
  },
  stateFile: {
    path: 'ez4-state'
  }
};
