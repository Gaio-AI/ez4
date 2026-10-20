import type { MigrationRelationError } from '@ez4/pgmigration/library';
import type { TableIndex, TableRelation } from '@ez4/database/library';

import { describe, it } from 'node:test';
import { deepEqual, equal, throws } from 'assert/strict';

import { getCreateQueries, getUnindexedForeignKeys, getUpdateStepQueries, validateRepository } from '@ez4/pgmigration';
import { getTableRepository } from '@ez4/pgclient/library';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

describe('migration :: scoped relation tests', () => {
  const contactKey: TableIndex = { name: 'account_id:id', type: Index.Unique, columns: ['account_id', 'id'] };

  const getRepository = (
    relation: Partial<TableRelation> = {},
    contactIndexes: TableIndex[] = [contactKey],
    messageIndexes: TableIndex[] = []
  ) => {
    return getTableRepository([
      {
        name: 'messages',
        indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }, ...messageIndexes],
        relations: [
          {
            sourceTable: 'contacts',
            sourceColumn: 'id',
            sourceIndex: Index.Primary,
            targetAlias: 'contact',
            targetColumn: 'contact_id',
            scope: ['account_id'],
            ...relation
          }
        ],
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String, format: 'uuid' },
            account_id: { type: SchemaType.String, format: 'uuid' },
            contact_id: { type: SchemaType.String, format: 'uuid', optional: true, nullable: true }
          }
        }
      },
      {
        name: 'contacts',
        indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }, ...contactIndexes],
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String, format: 'uuid' },
            account_id: { type: SchemaType.String, format: 'uuid' }
          }
        }
      }
    ]);
  };

  const assertRelationError = (repository: ReturnType<typeof getRepository>, message: string) => {
    throws(
      () => validateRepository(repository),
      (error: MigrationRelationError) => {
        equal(error.message, message);
        return true;
      }
    );
  };

  it('assert :: create scoped relation', () => {
    const queries = getCreateQueries(getRepository());

    deepEqual(
      queries.relations[0].query,
      `ALTER TABLE IF EXISTS "messages" ADD CONSTRAINT "messages_contact_fk" ` +
        `FOREIGN KEY ("account_id", "contact_id") REFERENCES "contacts" ("account_id", "id") ` +
        `ON DELETE SET null ("contact_id") ON UPDATE CASCADE NOT VALID`
    );
  });

  it('assert :: create scoped relation with a delete action', () => {
    const queries = getCreateQueries(getRepository({ onDelete: 'cascade' }));

    deepEqual(
      queries.relations[0].query,
      `ALTER TABLE IF EXISTS "messages" ADD CONSTRAINT "messages_contact_fk" ` +
        `FOREIGN KEY ("account_id", "contact_id") REFERENCES "contacts" ("account_id", "id") ` +
        `ON DELETE CASCADE ON UPDATE CASCADE NOT VALID`
    );
  });

  it('assert :: scope a relation that had none', () => {
    const steps = getUpdateStepQueries(getRepository(), getRepository({ scope: undefined }));

    deepEqual(
      steps.rollout.relations.map(({ query }) => query),
      [
        `ALTER TABLE IF EXISTS "messages" ADD CONSTRAINT "messages_contact_tmp_fk" ` +
          `FOREIGN KEY ("account_id", "contact_id") REFERENCES "contacts" ("account_id", "id") ` +
          `ON DELETE SET null ("contact_id") ON UPDATE CASCADE NOT VALID`,
        `ALTER TABLE IF EXISTS "messages" VALIDATE CONSTRAINT "messages_contact_tmp_fk"`
      ]
    );
  });

  it('assert :: valid scoped relation', () => {
    validateRepository(getRepository());
  });

  it('assert :: scoped relation without a key on its columns', () => {
    assertRelationError(
      getRepository({}, []),
      'Relation messages.contact references id within account_id, which needs a primary or unique key on account_id, id in contacts.'
    );
  });

  it('assert :: scoped relation repeating a key column', () => {
    const message = 'Relation messages.contact has a scope that repeats a column of its key.';

    assertRelationError(getRepository({ scope: ['id'] }), message);
    assertRelationError(getRepository({ scope: ['contact_id'] }), message);
    assertRelationError(getRepository({ scope: ['account_id', 'account_id'] }), message);
  });

  it('assert :: scoped relation by a column that takes null', () => {
    const repository = getRepository();

    repository.messages.schema.properties.account_id = { type: SchemaType.String, format: 'uuid', nullable: true };

    assertRelationError(
      repository,
      `Relation messages.contact is scoped by account_id, which takes null: the key isn't checked on records without it.`
    );
  });

  it('assert :: scoped relation without a foreign key', () => {
    assertRelationError(getRepository({ foreignKey: false }), 'Relation messages.contact has a scope but no foreign key.');
  });

  it('assert :: scoped relation led by its key columns', () => {
    const keyIndex: TableIndex = { name: 'account_id:contact_id', type: Index.Secondary, columns: ['account_id', 'contact_id'] };
    const scopeIndex: TableIndex = { name: 'account_id', type: Index.Secondary, columns: ['account_id'] };

    deepEqual(getUnindexedForeignKeys(getRepository({}, [contactKey], [keyIndex]), {}), []);

    deepEqual(getUnindexedForeignKeys(getRepository({}, [contactKey], [scopeIndex]), {}), [
      { table: 'messages', column: 'contact_id', sourceTable: 'contacts' }
    ]);
  });
});
