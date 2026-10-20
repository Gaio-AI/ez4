import type { PgTableRepository } from '@ez4/pgclient/library';

import type { MigrationNameCollisionError } from '@ez4/pgmigration/library';

import { describe, it } from 'node:test';
import { deepEqual, equal, notEqual, ok, throws } from 'assert/strict';

import { validateRepository } from '@ez4/pgmigration';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { getStoredName, getTemporaryName } from '../../src/utils/naming';

describe('migration :: naming tests', () => {
  const getRepository = (table: string, indexKeys: string[]): PgTableRepository => {
    const columns = [...new Set(indexKeys.flatMap((indexKey) => indexKey.split(':')))];

    return {
      [table]: {
        name: table,
        relations: {},
        schema: {
          type: SchemaType.Object,
          properties: Object.fromEntries(columns.map((column) => [column, { type: SchemaType.String }]))
        },
        indexes: Object.fromEntries(
          indexKeys.map((indexKey) => [indexKey, { name: indexKey, type: Index.Secondary, columns: indexKey.split(':') }])
        )
      }
    };
  };

  it('assert :: temporary name of a short name', () => {
    equal(getTemporaryName('table_column_pk'), 'table_column_tmp_pk');
  });

  it('assert :: temporary name of a long name', () => {
    const name = 'interaction_lists_interactions_interaction_list_id_interaction_id_linked_message_id_pk';

    const temporaryName = getTemporaryName(name);

    ok(Buffer.byteLength(temporaryName) <= 63);
    ok(temporaryName.endsWith('_tmp_pk'));

    notEqual(getStoredName(temporaryName), getStoredName(name));
    equal(getTemporaryName(name), temporaryName);
  });

  it('assert :: names that stay distinct once truncated', () => {
    validateRepository({
      ...getRepository('interaction_lists_interactions', ['interaction_list_id:active:interaction_id', 'account_id:created_at']),
      ...getRepository('contact_sources', ['account_id:source_type:external_id:connection_id'])
    });
  });

  it('assert :: names that collide once truncated', () => {
    const repository = getRepository('table_with_a_rather_long_name', [
      'first_column_with_a_long_name:second_column_one',
      'first_column_with_a_long_name:second_column_two'
    ]);

    throws(
      () => validateRepository(repository),
      (error: MigrationNameCollisionError) => {
        deepEqual(error.names, [
          'table_with_a_rather_long_name_first_column_with_a_long_name_second_column_one_sk',
          'table_with_a_rather_long_name_first_column_with_a_long_name_second_column_two_sk'
        ]);
        return error.message.startsWith('Names longer than 63 bytes collide');
      }
    );
  });
});
