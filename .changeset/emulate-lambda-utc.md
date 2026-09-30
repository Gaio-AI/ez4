---
'@ez4/project': patch
---

`ez4 serve`, `ez4 test` and `ez4 run` set `TZ` to `UTC`, as Lambda runs every function, whatever the machine's time zone. A handler that reads a time without a zone, as the Aurora Data API returns a `timestamptz`, now gets the same instant locally as in production; before, a machine in UTC−3 read it three hours later. Tests run in UTC too, as CI runners already do.
