import type { PgTableRepository, PgTableIndex, PgTableMetadata } from '@ez4/pgclient/library';
import type { AnySchema, ObjectSchema } from '@ez4/schema';
import type { ObjectComparison } from '@ez4/utils';

import { deepEqual, deepCompareObject, isAnyObject, isEmptyObject, toSnakeCase } from '@ez4/utils';
import { isTableMetadata, isTableIndex } from '@ez4/pgclient/library';
import { isAnySchema } from '@ez4/schema';

export type PgTableRepositoryChanges = ObjectComparison & {
  source: PgTableRepository;
};

/**
 * The changes from the source to the target repository. Declared renames (`renamedFrom`) align the
 * source with the target before they are compared, so a renamed table or column compares to what it
 * was, and only the renames left undeclared are detected by name.
 */
export const getTableRepositoryChanges = (target: PgTableRepository, source: PgTableRepository) => {
  const alignedSource = { ...source };

  const tableRenames: Record<string, string> = {};
  const columnRenames: Record<string, Record<string, string>> = {};

  for (const table in target) {
    const previousTable = target[table].renamedFrom?.table;

    if (previousTable && !source[table] && source[previousTable]) {
      tableRenames[previousTable] = table;

      alignedSource[table] = source[previousTable];

      delete alignedSource[previousTable];
    }

    const sourceTable = alignedSource[table];
    const renames = sourceTable && getColumnRenames(target[table], sourceTable);

    if (renames) {
      columnRenames[table] = renames;
      alignedSource[table] = renameColumns(sourceTable, renames);
    }
  }

  const changes = getRepositoryChanges(target, alignedSource);
  const normalizedSource = { ...alignedSource };
  const nested = { ...changes.nested };

  for (const fromTable in changes.rename) {
    const toTable = changes.rename[fromTable];
    const renames = getColumnRenames(target[toTable], source[fromTable]);

    const sourceTable = renames ? renameColumns(source[fromTable], renames) : source[fromTable];

    if (renames) {
      columnRenames[toTable] = renames;
    }

    normalizedSource[toTable] = sourceTable;

    delete normalizedSource[fromTable];

    const { nested: nestedChanges } = getRepositoryChanges(
      {
        [toTable]: target[toTable]
      },
      {
        [toTable]: sourceTable
      }
    );

    const renamedChanges = nestedChanges?.[toTable];

    if (renamedChanges) {
      nested[toTable] = renamedChanges;
    }
  }

  let allChanges = addRenames({ ...changes, nested }, [], tableRenames);

  for (const table in columnRenames) {
    allChanges = addRenames(allChanges, [table, 'schema', 'properties'], columnRenames[table]);
  }

  return {
    ...allChanges,
    source: normalizedSource
  };
};

// The declared column renames a source table hasn't gone through yet: the column still has its previous name there.
const getColumnRenames = (target: PgTableMetadata, source: PgTableMetadata) => {
  const sourceColumns = source.schema.properties;
  const renames: Record<string, string> = {};

  for (const [column, previousColumn] of Object.entries(target.renamedFrom?.columns ?? {})) {
    if (sourceColumns[previousColumn] && !sourceColumns[column]) {
      renames[previousColumn] = column;
    }
  }

  return isEmptyObject(renames) ? undefined : renames;
};

const renameColumns = (table: PgTableMetadata, renames: Record<string, string>): PgTableMetadata => {
  const properties = { ...table.schema.properties };

  for (const fromColumn in renames) {
    properties[renames[fromColumn]] = properties[fromColumn];

    delete properties[fromColumn];
  }

  return {
    ...table,
    schema: {
      ...table.schema,
      properties
    }
  };
};

// Adds renames to the comparison at the given path, counting each level it creates as a change of its parent.
const addRenames = (comparison: ObjectComparison | undefined, path: string[], renames: Record<string, string>): ObjectComparison => {
  const current = comparison ?? { counts: 0 };

  if (isEmptyObject(renames)) {
    return current;
  }

  if (!path.length) {
    return {
      ...current,
      counts: current.counts + Object.keys(renames).length,
      rename: { ...current.rename, ...renames }
    };
  }

  const [key, ...nestedPath] = path;
  const nested = current.nested?.[key];

  return {
    ...current,
    counts: current.counts + (nested ? 0 : 1),
    nested: {
      ...current.nested,
      [key]: addRenames(nested, nestedPath, renames)
    }
  };
};

// How a table was renamed tells the migration what to do, but isn't part of the table.
const withoutRenames = (repository: PgTableRepository) => {
  const tables: PgTableRepository = {};

  for (const table in repository) {
    const { renamedFrom: _renamedFrom, ...metadata } = repository[table];

    tables[table] = metadata;
  }

  return tables;
};

const getRepositoryChanges = (target: PgTableRepository, source: PgTableRepository) => {
  return deepCompareObject(withoutRenames(target), withoutRenames(source), {
    onCompareName: (target, source) => {
      const targetParts = new Set(toSnakeCase(target).split('_'));
      const sourceParts = new Set(toSnakeCase(source).split('_'));

      for (const sourcePart of sourceParts) {
        if (sourcePart.length > 1 && targetParts.has(sourcePart)) {
          return true;
        }
      }

      return false;
    },
    onRename: (target, source) => {
      if (!isAnyObject(target) || !isAnyObject(source)) {
        return false;
      }

      if (isTableMetadata(target) && isTableMetadata(source)) {
        return canRenameTable(target.schema, source.schema);
      }

      if (isTableIndex(target) && isTableIndex(source)) {
        return canRenameIndex(target, source);
      }

      if (isAnySchema(target) && isAnySchema(source)) {
        return canRenameColumn(target, source);
      }

      return false;
    }
  });
};

const canRenameTable = (target: ObjectSchema, source: ObjectSchema) => {
  const targetColumns = Object.keys(target.properties);
  const sourceColumns = Object.keys(source.properties);

  if (targetColumns.length && sourceColumns.length) {
    const keptColumns = sourceColumns.filter((column) => targetColumns.includes(column));

    return keptColumns.length * 2 >= sourceColumns.length;
  }

  return true;
};

// A rename keeps the index as it is built: one that also changes its included columns, predicate or
// order is built again under its new name, and the old one is dropped.
const canRenameIndex = (target: PgTableIndex, source: PgTableIndex) => {
  return (
    target.type === source.type &&
    deepEqual(target.columns, source.columns) &&
    deepEqual(target.options ?? {}, source.options ?? {}, { exclude: { name: true } })
  );
};

const canRenameColumn = (target: AnySchema, source: AnySchema) => {
  return deepEqual(target, source, {
    depth: 1,
    include: {
      type: true,
      definitions: true,
      nullable: true,
      format: true
    }
  });
};
