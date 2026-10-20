import type { PgTableRepository } from '@ez4/pgclient/library';

import { getStepStatements } from '../utils/steps';
import { getUpdateStepQueries } from './queries';

/**
 * The statements the migration from the source to the target repository runs, labeled by step
 * (`prepare.1`, `rollout.1`, `cleanup.1`…) in the order each step runs them. A deploy plan shows these
 * rather than the repository diff alone, which hides what a change costs: a nested field of a JSON
 * column emits nothing, while dropping the index of a relation can rebuild its foreign key.
 */
export const getMigrationStatements = (target: PgTableRepository, source: PgTableRepository) => {
  const steps = getUpdateStepQueries(target, source);
  const statements: Record<string, string> = {};

  for (const step of ['prepare', 'rollout', 'cleanup'] as const) {
    getStepStatements(steps[step], step).forEach(({ query, condition }, position) => {
      statements[`${step}.${position + 1}`] = condition ? `${query} -- ${condition}` : query;
    });
  }

  return statements;
};
