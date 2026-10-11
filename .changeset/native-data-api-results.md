---
'@ez4/pgclient': minor
'@ez4/aws-aurora': minor
---

The native Aurora driver returns raw results in the shapes the Data API returns, and handles two connection failures it used to surface:

- **Result shapes:** a service linked in native mode used to get `pg`'s own shapes from a raw query (`'12'` for a `count(*)`, `bigint` or `numeric`, a `Date` for a `timestamptz` or `date`), while the Data API and the local emulation return `12`, the UTC text `2026-09-17 23:08:20.800` and `2026-09-17`. It now gets the Data API shapes, so a raw query reads the same in native mode, in Data API mode and in local tests, and a service moves to native mode without changing its queries. A json value of a table query (one with metadata) is parsed once: a jsonb string scalar such as `"123"` used to come back as the number `123`. The Data API statement timeout, result size limit and refused types stay out of native mode.
- **Frozen Lambda:** the pool's idle timer doesn't run while a Lambda is frozen, so after a long freeze it handed out a connection the RDS Proxy or the server may have closed, and the statement failed with "Connection terminated unexpectedly". A connection idle for longer than the idle timeout (5 minutes, by the wall clock) is now discarded on checkout and a new one is opened.
- **Slow first connection:** opening a connection that takes longer than the connection timeout (a cold Lambda in a VPC signing in with IAM over TLS) failed with "Connection terminated due to connection timeout" and wasn't retried. It's now retried with the other unavailable-database errors.

Supporting change:

- `@ez4/pgclient`: `ClientDriver` takes `dataApiResults: true` to return raw results in the Data API shapes without the rest of the Data API behavior.
