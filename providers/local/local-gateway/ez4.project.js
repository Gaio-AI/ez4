/**
 * @type {import('@ez4/project').ProjectOptions}
 */
export default {
  prefix: 'ez4',
  projectName: 'local-gateway',
  sourceFiles: ['./test/fixtures/items.ts'],
  customProviders: {
    packages: ['@ez4/local-gateway']
  },
  stateFile: {
    path: 'ez4-state'
  }
};
