---
'@ez4/project': patch
'@ez4/pgclient': patch
---

Turn non-alphanumeric separators in the branch name into dashes (`feat/x` becomes `feat-x` instead of `featx`) and keep database names within the 63-char Postgres limit with a hash suffix. Breaking for deploys whose branch contains separators: their resource names change.
