import type { DatabaseService } from '@ez4/database/library';
import type { CommonOptions } from '@ez4/project/library';

import { toSnakeCase } from '@ez4/utils';
import { createHash } from 'node:crypto';

const POSTGRES_MAX_NAME_LENGTH = 63;

export const getDatabaseName = (service: DatabaseService, options: CommonOptions) => {
  const branchName = toSnakeCase(options.branchName);
  const projectName = toSnakeCase(options.projectName);
  const serviceName = toSnakeCase(service.name);

  const name = `${projectName}_${serviceName}${branchName ? `_${branchName}` : ``}`;

  if (name.length <= POSTGRES_MAX_NAME_LENGTH) {
    return name;
  }

  const hash = createHash('sha256').update(name).digest('hex').substring(0, 6);

  return `${name.substring(0, POSTGRES_MAX_NAME_LENGTH - hash.length - 1)}_${hash}`;
};

export const getTableName = (table: string) => {
  return toSnakeCase(table);
};
