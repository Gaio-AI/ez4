---
'@ez4/pgsql': patch
---

A JSON key no longer reaches a statement as raw text. `update` wrote the keys of a merged JSON object between
quotes without escaping them, so a key carrying a quote ran as SQL, and a key ending in a backslash made the RDS
Data API leave every parameter after it unbound. Inside a JSON column, `update` now binds each key as a parameter.
Where a key is still written into the statement (filters, `isMissing`, JSON selects), its quotes are doubled and
each backslash is written as `chr(92)`: the Data API parses that correctly, and Postgres folds it back into the
same constant, so expression indexes on JSON paths still match.
