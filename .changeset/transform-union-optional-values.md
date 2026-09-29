---
'@ez4/transform': patch
---

Inside a union, an object whose optional property holds an invalid value no longer matches that branch with the property silently dropped. The value now reaches validation, so a filter with an unknown operator is rejected instead of losing its operator. A `null` on an optional, non-nullable property is still dropped and the branch still matches, so a queue message or topic event carrying such a `null` keeps going through.
