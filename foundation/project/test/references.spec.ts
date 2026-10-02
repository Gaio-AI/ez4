import type { ProjectOptions, ProjectReferenceOptions } from '../src/types/project';

import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { loadReferences } from '../src/config/references';

// The referenced project sits next to the importing one, as in a monorepo.
const workspacePath = 'test/files/project';

const getProject = (reference: Omit<ProjectReferenceOptions, 'projectFile'>): ProjectOptions => {
  return {
    projectName: 'project',
    sourceFiles: [],
    stateFile: {
      path: 'project-state'
    },
    references: {
      '@test/reference': {
        projectFile: '../reference/ez4.project.js',
        ...reference
      }
    }
  };
};

describe('project references', () => {
  it('assert :: a reference is enabled by default', async () => {
    const { imports, paths } = await loadReferences(getProject({}), workspacePath);

    equal('disabled' in imports['@test/reference']!, false);

    deepEqual(paths, {
      '@test/reference': ['test/files/reference/src/main.ts']
    });
  });

  it('assert :: an enabled reference loads as one without the option', async () => {
    const enabled = await loadReferences(getProject({ enabled: true }), workspacePath);
    const omitted = await loadReferences(getProject({}), workspacePath);

    deepEqual(enabled, omitted);
  });

  it('assert :: a disabled reference is marked and still provides its paths', async () => {
    const { imports, paths } = await loadReferences(getProject({ enabled: false }), workspacePath);
    const { imports: enabledImports } = await loadReferences(getProject({}), workspacePath);

    deepEqual(imports['@test/reference'], {
      ...enabledImports['@test/reference'],
      disabled: true
    });

    deepEqual(paths, {
      '@test/reference': ['test/files/reference/src/main.ts']
    });
  });
});
