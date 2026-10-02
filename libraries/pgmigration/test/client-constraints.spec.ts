import type { PgMigrationQueries, PgMigrationStatement } from '@ez4/pgmigration/library';
import type { PgTableRepository } from '@ez4/pgclient/library';

import { afterEach, beforeEach, describe, it } from 'node:test';
import { deepEqual } from 'assert/strict';

import { getCreateQueries, getDeleteQueries, getUpdateStepQueries } from '@ez4/pgmigration';
import { MigrationAssertionFailedError, MigrationValidationFailedError } from '@ez4/pgmigration/library';
import { Client } from '@ez4/pgclient/driver';
import { SchemaType } from '@ez4/schema';

describe('migration :: client constraints tests', () => {
  const client = Client.make({
    debug: false,
    repository: {},
    connection: {
      database: 'postgres',
      password: 'postgres',
      user: 'postgres',
      host: '127.0.0.1'
    }
  });

  const getRepository = (values: string[]): PgTableRepository => {
    return {
      constraint_changes: {
        name: 'constraint_changes',
        indexes: {},
        relations: {},
        schema: {
          type: SchemaType.Object,
          properties: {
            status: {
              type: SchemaType.Enum,
              options: values.map((value) => ({ value }))
            }
          }
        }
      }
    };
  };

  const getQueries = (constraints: PgMigrationStatement[]): PgMigrationQueries => {
    return {
      tables: [],
      constraints,
      validations: [],
      relations: [],
      indexes: []
    };
  };

  const sourceValues = ['a', 'b'];

  const sourceRepository = getRepository(sourceValues);

  const constraintName = 'constraint_changes_status_ck';

  const getViolation = (name: string) => {
    return `new row for relation "constraint_changes" violates check constraint "${name}"`;
  };

  const getAssertion = (name: string) => {
    return new MigrationAssertionFailedError(name).message;
  };

  const runStatement = async ({ name, assert, check, query }: PgMigrationStatement) => {
    if (assert) {
      const [shouldFail] = await client.rawQuery(assert);

      if (shouldFail) {
        throw new MigrationAssertionFailedError(name);
      }
    }

    if (check) {
      const [shouldSkip] = await client.rawQuery(check);

      if (shouldSkip) {
        return;
      }
    }

    await client.rawQuery(query);
  };

  // Like the deploy, a failing statement is recorded and the next one still runs.
  const runPhase = async (queries: PgMigrationQueries) => {
    const statements = [...queries.tables, ...queries.constraints, ...queries.indexes, ...queries.relations];

    const errors = [];

    for (const statement of statements) {
      try {
        await runStatement(statement);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${error}`);
      }
    }

    return errors;
  };

  const runIntegrity = async (repository: PgTableRepository) => {
    for (const { name, check } of getCreateQueries(repository).validations) {
      const [hasError] = await client.rawQuery(check);

      if (hasError) {
        throw new MigrationValidationFailedError(name);
      }
    }
  };

  // Rollout and the integrity check run while the old code is live, and cleanup runs only after
  // every function has switched to the new code.
  const deploy = async <T>(targetRepository: PgTableRepository, onSwitch?: () => Promise<T>) => {
    const steps = getUpdateStepQueries(targetRepository, sourceRepository);

    const rollout = [...(await runPhase(steps.prepare)), ...(await runPhase(steps.rollout))];

    if (rollout.length) {
      return { rollout };
    }

    await runIntegrity(targetRepository);

    const writes = await onSwitch?.();

    const cleanup = await runPhase(steps.cleanup);

    return { rollout, writes, cleanup };
  };

  const writeStatus = async (status: string) => {
    try {
      await client.rawQuery(`INSERT INTO "constraint_changes" ("status") VALUES ('${status}')`);

      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : `${error}`;
    }
  };

  const writeAll = async (values: string[]) => {
    const writes: Record<string, string> = {};

    for (const value of values) {
      writes[value] = await writeStatus(value);
    }

    return writes;
  };

  const getConstraints = async () => {
    return client.rawQuery(
      `SELECT "conname", "convalidated" FROM "pg_constraint" ` +
        `WHERE "conrelid" = '"constraint_changes"'::regclass AND "contype" = 'c' ORDER BY "conname"`
    );
  };

  const getConstraintId = async () => {
    return client.rawQuery(`SELECT "oid"::text FROM "pg_constraint" WHERE "conname" = '${constraintName}'`);
  };

  const resetTable = async () => {
    await runPhase(getDeleteQueries(sourceRepository));
    await runPhase(getCreateQueries(sourceRepository));

    await client.rawQuery(`INSERT INTO "constraint_changes" ("status") VALUES ('a')`);
  };

  const assertRetryConverges = async (targetValues: string[]) => {
    const targetRepository = getRepository(targetValues);

    const { rollout, cleanup } = getUpdateStepQueries(targetRepository, sourceRepository);

    const statements = [...rollout.constraints, ...cleanup.constraints];

    const removedValues = sourceValues.filter((value) => !targetValues.includes(value));

    const acceptedWrites = (values: string[]) => {
      return Object.fromEntries(values.map((value) => [value, 'accepted']));
    };

    for (let index = 0; index <= statements.length; index++) {
      await resetTable();

      // A deploy that stops right after this statement leaves the database in this state.
      const partial = await runPhase(getQueries(statements.slice(0, index)));

      // Until rollout ends the old code is live, and once it ends the new code may be.
      const oldCode = index <= rollout.constraints.length ? await writeAll(sourceValues) : {};
      const newCode = index >= rollout.constraints.length ? await writeAll(targetValues) : {};

      await client.rawQuery(`DELETE FROM "constraint_changes"`);

      const retry = await deploy(targetRepository);

      deepEqual(
        {
          statement: index,
          partial,
          oldCode,
          newCode,
          retry,
          constraints: await getConstraints(),
          writes: await writeAll([...targetValues, ...removedValues])
        },
        {
          statement: index,
          partial: [],
          oldCode: index <= rollout.constraints.length ? acceptedWrites(sourceValues) : {},
          newCode: index >= rollout.constraints.length ? acceptedWrites(targetValues) : {},
          retry: {
            rollout: [],
            writes: undefined,
            cleanup: []
          },
          constraints: [
            {
              conname: constraintName,
              convalidated: true
            }
          ],
          writes: {
            ...acceptedWrites(targetValues),
            ...Object.fromEntries(removedValues.map((value) => [value, getViolation(constraintName)]))
          }
        }
      );
    }
  };

  beforeEach(async () => {
    await resetTable();
  });

  afterEach(async () => {
    await runPhase(getDeleteQueries(sourceRepository));
  });

  it('assert :: add enum value', async () => {
    const result = await deploy(getRepository(['a', 'b', 'c']), async () => {
      return {
        oldCode: await writeStatus('b'),
        newCode: await writeStatus('c')
      };
    });

    deepEqual(result, {
      rollout: [],
      writes: {
        oldCode: 'accepted',
        newCode: 'accepted'
      },
      cleanup: []
    });

    deepEqual(await getConstraints(), [
      {
        conname: constraintName,
        convalidated: true
      }
    ]);

    deepEqual(await writeAll(['c', 'd']), {
      c: 'accepted',
      d: getViolation(constraintName)
    });
  });

  it('assert :: remove enum value', async () => {
    const result = await deploy(getRepository(['a']), async () => {
      const writes = {
        oldCode: await writeStatus('b'),
        newCode: await writeStatus('a')
      };

      // The removed value can only be rejected once no row holds it.
      await client.rawQuery(`DELETE FROM "constraint_changes" WHERE "status" = 'b'`);

      return writes;
    });

    deepEqual(result, {
      rollout: [],
      writes: {
        oldCode: 'accepted',
        newCode: 'accepted'
      },
      cleanup: []
    });

    deepEqual(await getConstraints(), [
      {
        conname: constraintName,
        convalidated: true
      }
    ]);

    deepEqual(await writeAll(['a', 'b']), {
      a: 'accepted',
      b: getViolation(constraintName)
    });
  });

  it('assert :: add and remove enum values', async () => {
    const result = await deploy(getRepository(['a', 'c']), async () => {
      const writes = {
        oldCode: await writeStatus('b'),
        newCode: await writeStatus('c')
      };

      // The removed value can only be rejected once no row holds it.
      await client.rawQuery(`DELETE FROM "constraint_changes" WHERE "status" = 'b'`);

      return writes;
    });

    deepEqual(result, {
      rollout: [],
      writes: {
        oldCode: 'accepted',
        newCode: 'accepted'
      },
      cleanup: []
    });

    deepEqual(await getConstraints(), [
      {
        conname: constraintName,
        convalidated: true
      }
    ]);

    deepEqual(await writeAll(['a', 'b', 'c']), {
      a: 'accepted',
      b: getViolation(constraintName),
      c: 'accepted'
    });
  });

  it('assert :: reorder enum values', async () => {
    const constraintId = await getConstraintId();

    const result = await deploy(getRepository(['b', 'a']));

    deepEqual(result, {
      rollout: [],
      writes: undefined,
      cleanup: []
    });

    deepEqual(await getConstraintId(), constraintId);
  });

  it('assert :: remove enum value still held by rows', async () => {
    const targetRepository = getRepository(['a']);

    const result = await deploy(targetRepository, async () => {
      return {
        oldCode: await writeStatus('b')
      };
    });

    deepEqual(result, {
      rollout: [],
      writes: {
        oldCode: 'accepted'
      },
      cleanup: [
        getAssertion(constraintName),
        `constraint "constraint_changes_status_tmp_ck" of relation "constraint_changes" does not exist`
      ]
    });

    deepEqual(await getConstraints(), [
      {
        conname: constraintName,
        convalidated: true
      }
    ]);

    await client.rawQuery(`DELETE FROM "constraint_changes" WHERE "status" = 'b'`);

    deepEqual(await deploy(targetRepository), {
      rollout: [],
      writes: undefined,
      cleanup: []
    });

    deepEqual(await writeAll(['a', 'b']), {
      a: 'accepted',
      b: getViolation(constraintName)
    });
  });

  it('assert :: swap waits for the new check to be validated', async () => {
    const { rollout } = getUpdateStepQueries(getRepository(['a', 'b', 'c']), sourceRepository);

    // A validation still running in another session leaves the new check as not validated.
    const [createStatement, , ...swapStatements] = rollout.constraints;

    deepEqual(await runPhase(getQueries([createStatement])), []);

    deepEqual(await runPhase(getQueries(swapStatements)), [
      getAssertion('constraint_changes_status_tmp_ck'),
      getAssertion('constraint_changes_status_tmp_ck')
    ]);

    deepEqual(await getConstraints(), [
      {
        conname: constraintName,
        convalidated: true
      },
      {
        conname: 'constraint_changes_status_tmp_ck',
        convalidated: false
      }
    ]);

    deepEqual(await writeAll(sourceValues), {
      a: 'accepted',
      b: 'accepted'
    });
  });

  it('assert :: retry converges (add enum value)', async () => {
    await assertRetryConverges(['a', 'b', 'c']);
  });

  it('assert :: retry converges (remove enum value)', async () => {
    await assertRetryConverges(['a']);
  });

  it('assert :: retry converges (add and remove enum values)', async () => {
    await assertRetryConverges(['a', 'c']);
  });
});
