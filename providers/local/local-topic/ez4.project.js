/**
 * @type {import('@ez4/project').ProjectOptions}
 */
export default {
  prefix: 'ez4',
  projectName: 'local-topic',
  sourceFiles: ['./test/fixtures/alerts.ts'],
  customProviders: {
    packages: ['@ez4/local-topic']
  },
  stateFile: {
    path: 'ez4-state'
  }
};
