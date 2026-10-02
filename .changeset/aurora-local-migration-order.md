---
'@ez4/aws-aurora': patch
---

Apply local Aurora migrations (`ez4 serve`, `ez4 test`) in the deploy order: prepare, then rollout, then cleanup. A change that adds a column together with an index or a relation on it no longer fails locally with `column "<name>" does not exist` while the same change deploys fine.
