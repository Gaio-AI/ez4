import type { ProjectOptions } from '../types/project';
import type { InputOptions } from '../terminal/options';
import type { ServeOptions } from '../types/options';

import { toKebabCase } from '@ez4/utils';

import { getServiceHost } from '../utils/project';
import { getServiceBranch, getServicePrefix } from '../utils/resource';

export const getServeOptions = (input: InputOptions, project: ProjectOptions): ServeOptions => {
  return {
    prefix: getServicePrefix(project.prefix),
    projectName: toKebabCase(project.projectName),
    branchName: getServiceBranch(input.branch ?? project.branchName),
    serviceHost: getServiceHost(project, input.branch),
    localOptions: project.localOptions ?? {},
    testOptions: project.testOptions ?? {},
    debug: input.debug ?? project.debugMode,
    reset: input.reset ?? project.resetMode,
    local: input.local ?? project.localMode,
    variables: project.variables,
    suppress: input.suppress,
    version: 0
  };
};
