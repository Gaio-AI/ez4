---
'@ez4/database': patch
---

Export `FilterRelationSchemas` and `NestedSelectRelationSchemas`, which a consumer's declaration emit names when an exported function returns a query result over related tables that reference each other; without them, `composite`/`declaration` projects failed with TS4023.
