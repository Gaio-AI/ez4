---
'@ez4/pgclient': patch
---

Order `findMany` by the table column instead of the formatted text that a selected date, time or date-time field returns, so an index on the column serves `order` with `take` instead of Postgres sorting every matching row. Returned values are unchanged.
