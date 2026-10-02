---
'@ez4/gateway': patch
'@ez4/aws-gateway': patch
'@ez4/local-gateway': patch
---

Add the `strictQueryStrings` HTTP preference, which answers `400 Malformed query strings.` to a query string the route request doesn't declare instead of dropping it.
