---
'@ez4/database': minor
'@ez4/pgmigration': minor
'@ez4/pgclient': minor
'@ez4/pgsql': minor
'@ez4/aws-aurora': patch
'@ez4/raw-pg': patch
---

An index can be declared as an object with options, besides its type:

```ts
indexes: {
  'account_id:created_at': {
    type: Index.Secondary;
    name: 'messages_active_by_account';
    where: { deleted_at: null };
    include: ['status'];
    order: { created_at: 'desc' };
  };
};
```

- `where` builds a partial index, with literal values compared as a query `where` compares them (`null`, a value, `not`, `gt`, `gte`, `lt`, `lte`, `isIn`, `isNull`). A partial unique index doesn't identify a record: the query types leave it out of the unique keys, and an upsert doesn't use it as its conflict target.
- `include`, `order`, `nullsNotDistinct` and `method` (`btree`, `hash`, `gin`, `gist`, `brin`) map to `INCLUDE`, `DESC`, `NULLS NOT DISTINCT` and `USING`.
- `name` gives the index its name in the database. It keeps that name when its table or columns are renamed, and adopting an index that already exists only takes declaring its name.
- `columns` lists the index columns when its key is a name rather than the columns, so two indexes can share their columns (a partial one beside a full one).

The migration builds an index with options concurrently like any other. A change to its options rebuilds it under a temporary name and swaps it in during the cleanup. The duplicate check before a unique index only looks at the rows the index covers, and counts null columns when nulls aren't distinct. `validateRepository` fails on options a method doesn't take: a unique index other than `btree`, `nullsNotDistinct` off a unique index, `order` off `btree`, `include` off `btree` and `gist`, or a `where` operator outside the list above. A primary key and a TTL index take no options besides `columns`.

The deploy plan warns about a secondary index covered by another index of its table, one whose columns start with its own, when one of the two is new or changed. A partial index whose `where` only leaves out the rows with no key now counts as the index of a foreign key in the warning about foreign keys without an index. `getMigrationWarnings` gives both warnings.

`@ez4/pgsql`: `CREATE INDEX` takes `.where()`, `.include()`, `.order()` and `.nullsNotDistinct()`.
