---
'@ez4/pgmigration': patch
---

A relation whose foreign key stays the same keeps its constraint when only its indexes change. Before, removing the single-column index that supports a relation column (or turning the referenced key from primary into unique) recreated the foreign key: `ADD … NOT VALID`, a `VALIDATE` that scans the whole table, then a `DROP CONSTRAINT` that takes a strong lock on both tables. Now that change emits only the `DROP INDEX CONCURRENTLY` of the index that left. The foreign key is still recreated when its table, its column or the referenced column changes.
