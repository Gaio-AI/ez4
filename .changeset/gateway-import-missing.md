---
'@ez4/aws-gateway': patch
---

Fail the deploy with `API resource '<name>' wasn't found.` when an imported HTTP API isn't on any page of the account's APIs, instead of searching from the first page again forever.
