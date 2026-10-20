---
'@ez4/database': minor
'@ez4/pgmigration': minor
'@ez4/pgclient': patch
---

A table declares the names it and its columns had with `renamedFrom`, and the migration renames them, keeping their data:

```ts
Database.UseTable<{
  name: 'contacts';
  renamedFrom: {
    table: 'people';
    columns: {
      full_name: 'name';
    };
  };
  schema: ContactSchema;
  indexes: ContactIndexes;
}>;
```

Until now a rename only happened when the migration guessed it from the names, which takes a removed and an added name sharing a word (and, for a column, the same type). A rename the guess missed, such as `name` to `title` or a table keeping fewer than half of its columns, dropped the column or the table (`DROP TABLE … CASCADE`) and created an empty one.

- **Contract.** A renamed column has to be in the schema and its previous name can't be, and each previous name becomes one column only. A previous table name can't be the name of another table, nor the previous name of another one (`InvalidTableRenameError`).
- **Migration.** A declared rename is applied before the comparison, so a renamed column can change in the same deploy (it is renamed first, then changed under its new name). Its indexes and constraints follow it as with a guessed rename. A rename already deployed is skipped, so the declaration can stay.
- **Plan warning.** The guess still runs for what isn't declared, and `getMigrationWarnings` (`getDetectedRenames`) warns about each table or column it renames.
