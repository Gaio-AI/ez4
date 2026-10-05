---
'@ez4/pgmigration': patch
---

Change the check of an enum or literal column on the side of the code switch where both versions of the code keep working: added values are accepted in the rollout, before the new code goes live, and removed values are rejected only in the cleanup, after the old code is gone. Adding and removing values in one change widens the check to both sets in the rollout and narrows it in the cleanup. Reordering the options no longer replaces the check, and the old check is dropped only once the new one is validated.
