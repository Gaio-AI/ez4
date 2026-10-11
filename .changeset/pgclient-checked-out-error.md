---
'@ez4/pgclient': patch
---

A connection the server or a proxy drops while a statement runs fails that statement instead of crashing the process. The pool listened for connection errors only while a connection was idle, so a checked-out one emitted an unhandled `'error'` event on top of failing the statement.
