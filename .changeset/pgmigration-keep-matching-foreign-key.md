---
'@ez4/pgmigration': patch
---

A migration that replaces a foreign key skips the replacement when the database already holds the key as the contract now declares it: the same columns, the same table and columns it references, cascading updates and the same delete action, validated. Declaring the delete action a key made earlier already has, such as `onDelete: 'cascade'` on a nullable column whose key was created cascading, no longer creates a new key and validates it, which reads the whole table. Each statement of the replacement carries the check, and the plan prints it as `unless the foreign key already has this definition`. A scoped key cleared on delete is still always replaced.
