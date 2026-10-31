import { ok, equal, deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import {
  IncompleteTableError,
  IncorrectSchemaTypeError,
  IncorrectTableTypeError,
  InvalidSchemaTypeError,
  InvalidTableRenameError,
  InvalidTableTimestampsError,
  InvalidTableTypeError,
  UnsupportedTableTimestampsError,
  registerTriggers
} from '@ez4/database/library';

import { InvalidServicePropertyError } from '@ez4/common/library';

import { parseFile } from './common/parser';

describe('database service errors', () => {
  registerTriggers();

  it('assert :: incomplete table', () => {
    const [error1] = parseFile('incomplete-table', 1);

    ok(error1 instanceof IncompleteTableError);
    deepEqual(error1.properties, ['name', 'schema', 'indexes']);
  });

  it('assert :: incorrect table', () => {
    const [error1] = parseFile('incorrect-table', 1);

    ok(error1 instanceof IncorrectTableTypeError);
    equal(error1.baseType, 'Database.Table');
    equal(error1.tableType, 'TestTable');
  });

  it('assert :: invalid table (declaration)', () => {
    const [error1] = parseFile('invalid-table-class', 1);

    ok(error1 instanceof InvalidTableTypeError);
    equal(error1.baseType, 'Database.Table');
  });

  it('assert :: invalid table (property)', () => {
    const [error1] = parseFile('invalid-table-property', 1);

    ok(error1 instanceof InvalidServicePropertyError);
    deepEqual(error1.propertyName, 'invalid_property');
  });

  it('assert :: invalid table renames', () => {
    const [error1, error2, error3] = parseFile('invalid-table-renames', 3);

    ok(error1 instanceof InvalidTableRenameError);
    equal(error1.tableName, 'contacts');
    equal(error1.renameName, 'missing');

    ok(error2 instanceof InvalidTableRenameError);
    equal(error2.renameName, 'full_name');

    ok(error3 instanceof InvalidTableRenameError);
    equal(error3.renameName, 'last_name');
  });

  it('assert :: invalid table renamed table', () => {
    const [error1] = parseFile('invalid-table-renamed-table', 1);

    ok(error1 instanceof InvalidTableRenameError);
    equal(error1.tableName, 'contacts');
    equal(error1.renameName, 'people');
  });

  it('assert :: invalid table timestamps', () => {
    const errors = parseFile('invalid-table-timestamps', 8);

    for (const error of errors) {
      ok(error instanceof InvalidTableTimestampsError);
    }

    deepEqual(
      errors.map((error) => [(error as InvalidTableTimestampsError).tableName, (error as InvalidTableTimestampsError).timestampName]),
      [
        ['missing', 'updated'],
        ['format', 'created'],
        ['optional', 'updated'],
        ['nullable', 'updated'],
        ['primary', 'created'],
        ['renamed', 'updated'],
        ['same', 'updated'],
        ['option', 'deleted']
      ]
    );
  });

  it('assert :: table timestamps on an engine without them', () => {
    const [error1] = parseFile('invalid-engine-timestamps', 1);

    ok(error1 instanceof UnsupportedTableTimestampsError);
    equal(error1.tableName, 'contacts');
  });

  it('assert :: incorrect table schema', () => {
    const [error1, error2] = parseFile('incorrect-schema', 2);

    ok(error1 instanceof IncorrectSchemaTypeError);
    equal(error1.baseType, 'Database.Schema');
    equal(error1.schemaType, 'TestSchema');

    ok(error2 instanceof IncompleteTableError);
    deepEqual(error2.properties, ['schema']);
  });

  it('assert :: invalid table schema', () => {
    const [error1, error2] = parseFile('invalid-schema', 2);

    ok(error1 instanceof InvalidSchemaTypeError);
    equal(error1.baseType, 'Database.Schema');

    ok(error2 instanceof IncompleteTableError);
    deepEqual(error2.properties, ['schema']);
  });
});
