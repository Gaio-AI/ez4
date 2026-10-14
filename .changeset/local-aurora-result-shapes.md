---
'@ez4/aws-aurora': minor
'@ez4/pgclient': minor
---

A local Aurora client returns raw query results in the Data API shapes, as a deployed client does in both connection modes, without turning on the Data API emulation. A project whose links are native can drop `localOptions.<database>.dataApi` and keep the shapes its queries were written for, with array parameters and no 45-second cut or 1 MiB limit, as in production. `ClientConnection` takes `dataApiResults`.
