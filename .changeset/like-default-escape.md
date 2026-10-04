---
'@ez4/pgsql': patch
---

`contains` and `startsWith` no longer write `ESCAPE '\'`. The backslash the pattern is escaped with is LIKE's
default escape, so the text still matches literally, and the RDS Data API reads the `\'` of that clause as an
escaped quote: every parameter after it was left unbound, and the statement failed with
`syntax error at or near ":"`.
