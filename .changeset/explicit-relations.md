---
'@ez4/database': minor
'@ez4/pgmigration': minor
'@ez4/pgclient': patch
'@ez4/pgsql': minor
'@ez4/aws-aurora': patch
'@ez4/raw-pg': patch
---

A relation can be declared as an object with options, besides its source string:

```ts
relations: {
  'account_id@account': {
    source: 'accounts:id';
    onDelete: 'restrict';
    foreignKey: true;
  };
};
```

- `onDelete` (`'cascade'`, `'set null'`, `'restrict'` or `'no action'`) sets what deleting the related record does. Without it, the action still follows the column: `SET NULL` when it takes null, `CASCADE` otherwise.
- `foreignKey` overrides whether the relation gets a foreign key, which the indexes of its columns decide otherwise. `true` gives one to a relation between two primary keys (a table that extends another by its key), which never had one. `false` keeps one off a relation.

The migration now compares each foreign key as the constraint it makes (what it references and its delete action) between the deployed and the declared repository. It is replaced once when it changes for more than one reason. Before, changing a relation and the nullability of its column in the same deploy emitted the replacement twice, and the second `DROP CONSTRAINT` in the cleanup dropped the key just renamed into place. A column whose relation sets its delete action no longer has its foreign key rebuilt when its nullability changes.

Before deploying, `validateRepository` (`@ez4/pgmigration`) fails on a relation Postgres can't build as declared:

- `foreignKey: true` to a column that isn't a primary or unique key;
- a delete action on a relation without a foreign key;
- `'set null'` on a column that doesn't take null;
- a key of another type than the column it references.

It replaces `validateRepositoryNames`, which it includes. `@ez4/pgsql` gains `noAction()` for a foreign key action.

The deploy plan warns about a foreign key the migration leaves with no index led by its column, either because the key is new or because it loses the index it had (`getUnindexedForeignKeys`). Deleting or updating a referenced record then scans the table holding the key. Keys that already had no index aren't reported again.
