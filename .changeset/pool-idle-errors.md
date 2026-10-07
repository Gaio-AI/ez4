---
'@ez4/pgclient': patch
---

The pg pool listens for errors on idle connections. When the server or a proxy ends an idle pooled connection (idle session timeout, restart, failover), pg emits it on the pool, and without a listener the process crashed; in a Lambda that happens when a frozen container resumes. The pool already drops that connection, so the next query connects again.
