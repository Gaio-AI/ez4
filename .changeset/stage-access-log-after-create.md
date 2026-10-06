---
'@ez4/aws-gateway': patch
---

A new HTTP stage with access logs is created before its access logs are turned on. The deploy turned them on first, on a stage that did not exist yet, so the first deploy of a gateway that logs its access failed with `Invalid stage identifier specified`.
