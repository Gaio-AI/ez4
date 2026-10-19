import type { PgTableRepository } from '@ez4/pgclient/library';

import { MigrationNameCollisionError } from '../errors/naming';
import { ConstraintQuery } from '../queries/constraints';
import { RelationQuery } from '../queries/relations';
import { IndexQueries } from '../queries/indexes';
import { getStoredName } from '../utils/naming';

/**
 * Throws when two object names of the repository are the same once Postgres truncates them: the second
 * object is never created (its existence check finds the first one) and dropping it would drop the first.
 * Indexes share one namespace and constraints another, since the migration looks constraints up by name.
 */
export const validateRepositoryNames = (target: PgTableRepository) => {
  const indexNames: string[] = [];
  const constraintNames: string[] = [];

  for (const table in target) {
    const { name, schema, indexes, relations } = target[table];

    const tableIndexNames = IndexQueries.getNames(name, indexes);

    indexNames.push(...tableIndexNames.indexes);

    constraintNames.push(
      ...tableIndexNames.constraints,
      ...RelationQuery.getNames(name, relations),
      ...ConstraintQuery.getNames(name, schema.properties)
    );
  }

  const collisions = [...getCollisions(indexNames), ...getCollisions(constraintNames)];

  if (collisions.length) {
    throw new MigrationNameCollisionError(collisions);
  }
};

const getCollisions = (names: string[]) => {
  const namesByStoredName = new Map<string, Set<string>>();

  for (const name of names) {
    const storedName = getStoredName(name);

    namesByStoredName.set(storedName, (namesByStoredName.get(storedName) ?? new Set()).add(name));
  }

  return [...namesByStoredName.values()].filter((group) => group.size > 1).flatMap((group) => [...group]);
};
