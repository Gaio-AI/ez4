---
'@ez4/database': minor
'@ez4/pgmigration': minor
'@ez4/pgclient': patch
'@ez4/pgsql': minor
---

A relation declared as an object takes `scope`, columns both tables have that its foreign key also references:

```ts
relations: {
  'contact_id@contact': {
    source: 'contacts:id';
    scope: ['account_id'];
  };
};
```

The foreign key becomes `FOREIGN KEY (account_id, contact_id) REFERENCES contacts (account_id, id)`, so a record only relates to one with the same values in the scope columns (of the same account, for example). `'set null'` clears only the relation column and keeps the scope (`ON DELETE SET NULL (contact_id)`, Postgres 15 or later). Adding, changing or removing a scope replaces the foreign key online, like any other change to it.

The contract fails on a scope column missing from either table, and `validateRepository` fails on a scope without a foreign key, on a scope that repeats a column of the key, on a scope column that takes null (Postgres doesn't check a key with a null column, so the record could relate to one of any scope), on a related table with no primary or unique key on exactly the scope and the related column, and on a scope column of another type in each table. The warning about foreign keys without an index counts an index led by the relation column or by all the key columns.

`@ez4/pgsql`: `foreign()` takes several key columns, for a foreign key that references several columns, and the delete action `null(columns)` sets only those columns to null.
