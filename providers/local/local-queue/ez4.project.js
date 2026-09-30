/**
 * @type {import('@ez4/project').ProjectOptions}
 */
export default {
  prefix: 'ez4',
  projectName: 'local-queue',
  sourceFiles: ['./test/fixtures/orders.ts'],
  customProviders: {
    packages: ['@ez4/local-queue']
  },
  stateFile: {
    path: 'ez4-state'
  }
};
