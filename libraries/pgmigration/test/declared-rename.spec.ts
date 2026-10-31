import type { TableIndex, TableRenames } from '@ez4/database/library';
import type { PgMigrationSteps } from '@ez4/pgmigration/library';
import type { AnySchema } from '@ez4/schema';

import { describe, it } from 'node:test';
import { deepEqual } from 'assert/strict';

import { getMigrationWarnings, getUpdateStepQueries } from '@ez4/pgmigration';
import { getTableRepositoryChanges } from '@ez4/pgmigration/library';
import { getTableRepository } from '@ez4/pgclient/library';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('migration :: declared rename tests', () => {
  const text: AnySchema = { type: SchemaType.String };

  const getRepository = (name: string, columns: Record<string, AnySchema>, renamedFrom?: TableRenames, indexes: TableIndex[] = []) => {
    return getTableRepository([
      {
        name,
        indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }, ...indexes],
        schema: { type: SchemaType.Object, properties: columns },
        ...(renamedFrom && { renamedFrom })
      }
    ]);
  };

  const getQueries = (steps: PgMigrationSteps) => {
    return (['prepare', 'rollout', 'cleanup'] as const).flatMap((step) => {
      const { tables, constraints, indexes, relations } = steps[step];

      return [...tables, ...constraints, ...indexes, ...relations].map(({ query }) => `${step}: ${query}`);
    });
  };

  it('assert :: declared column rename', () => {
    // The names share no word, so only the declaration makes it a rename.
    const source = getRepository('posts', { id: text, name: text });
    const target = getRepository('posts', { id: text, title: text }, { columns: { title: 'name' } });

    deepEqual(getQueries(getUpdateStepQueries(target, source)), ['rollout: ALTER TABLE IF EXISTS "posts" RENAME COLUMN "name" TO "title"']);

    // The deploy runs the migration only for a repository with changes.
    deepEqual(getTableRepositoryChanges(target, source).counts, 1);
  });

  it('assert :: declared column rename with a changed column', () => {
    const source = getRepository('posts', { id: text, name: text });
    const target = getRepository('posts', { id: text, title: { ...text, optional: true } }, { columns: { title: 'name' } });

    const [renameQuery, ...otherQueries] = getQueries(getUpdateStepQueries(target, source));

    deepEqual(renameQuery, 'rollout: ALTER TABLE IF EXISTS "posts" RENAME COLUMN "name" TO "title"');
    deepEqual(otherQueries, ['rollout: ALTER TABLE IF EXISTS "posts" ALTER COLUMN "title" DROP NOT null']);
  });

  it('assert :: declared column rename with an index', () => {
    const source = getRepository('posts', { id: text, name: text }, undefined, [
      { name: 'name', type: Index.Secondary, columns: ['name'] }
    ]);

    const target = getRepository('posts', { id: text, title: text }, { columns: { title: 'name' } }, [
      { name: 'title', type: Index.Secondary, columns: ['title'] }
    ]);

    deepEqual(getQueries(getUpdateStepQueries(target, source)), [
      'rollout: ALTER TABLE IF EXISTS "posts" RENAME COLUMN "name" TO "title"',
      'rollout: ALTER INDEX IF EXISTS "posts_name_sk" RENAME TO "posts_title_sk"'
    ]);
  });

  it('assert :: declared column rename in index options', () => {
    // The column moves with the rename in the order, the included columns and the where of an index, so the
    // index is the same and only its column is renamed: rebuilding it would hold the old code broken meanwhile.
    const columns = { id: text, account_id: text, name: text };

    const source = getRepository('posts', columns, undefined, [
      {
        name: 'listing',
        type: Index.Secondary,
        columns: ['account_id', 'name'],
        options: { name: 'idx_posts_listing', order: { name: 'desc' } }
      },
      {
        name: 'covering',
        type: Index.Secondary,
        columns: ['account_id'],
        options: { name: 'idx_posts_covering', include: ['name'], where: { name: { isNull: false } } }
      }
    ]);

    const target = getRepository('posts', { id: text, account_id: text, title: text }, { columns: { title: 'name' } }, [
      {
        name: 'listing',
        type: Index.Secondary,
        columns: ['account_id', 'title'],
        options: { name: 'idx_posts_listing', order: { title: 'desc' } }
      },
      {
        name: 'covering',
        type: Index.Secondary,
        columns: ['account_id'],
        options: { name: 'idx_posts_covering', include: ['title'], where: { title: { isNull: false } } }
      }
    ]);

    deepEqual(getQueries(getUpdateStepQueries(target, source)), ['rollout: ALTER TABLE IF EXISTS "posts" RENAME COLUMN "name" TO "title"']);
  });

  it('assert :: declared column rename already deployed', () => {
    const deployed = getRepository('posts', { id: text, title: text });
    const target = getRepository('posts', { id: text, title: text }, { columns: { title: 'name' } });

    deepEqual(getQueries(getUpdateStepQueries(target, deployed)), []);
    deepEqual(getTableRepositoryChanges(target, deployed).counts, 0);
  });

  it('assert :: declared table rename', () => {
    // Most of the columns change, so only the declaration makes it a rename.
    const source = { ...getRepository('people', { id: text, name: text }) };
    const target = getRepository('contacts', { id: text, full_name: text }, { table: 'people', columns: { full_name: 'name' } });

    deepEqual(getQueries(getUpdateStepQueries(target, source)), [
      'rollout: ALTER TABLE IF EXISTS "people" RENAME TO "contacts"',
      'rollout: ALTER TABLE IF EXISTS "contacts" RENAME COLUMN "name" TO "full_name"',
      'rollout: ALTER TABLE IF EXISTS "contacts" RENAME CONSTRAINT "people_id_pk" TO "contacts_id_pk"'
    ]);
  });

  it('assert :: detected rename warnings', () => {
    const source = getRepository('posts', { id: text, author_name: text });

    const detected = getRepository('posts', { id: text, author_title: text });
    const declared = getRepository('posts', { id: text, author_title: text }, { columns: { author_title: 'author_name' } });

    deepEqual(getMigrationWarnings(detected, source), [
      'Column posts.author_name is renamed to author_title because the names look alike: declare it in renamedFrom, ' +
        'or add author_title and remove author_name in separate deploys if it is not a rename.'
    ]);

    deepEqual(getMigrationWarnings(declared, source), []);
  });
});
