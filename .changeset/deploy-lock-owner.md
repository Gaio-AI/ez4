---
'@ez4/project': patch
'@ez4/aws-common': patch
---

A deploy no longer removes a lock it doesn't hold: the deploy lock records the run that acquired it, only that run releases it, and a deploy that fails with `Failed to acquire exclusive lock.` leaves the other run's lock in place, so a third deploy can't start applying next to the one still running. A lock left behind by a run that died is no longer cleared by the next failed attempt and has to be deleted from the lock table. `deploy` and `destroy` also check, once they hold the lock, that the state is still the one their plan was made from, and fail with `State changed since the plan was made, nothing was applied: run it again to plan against the current state.` instead of applying an outdated plan over the state another deploy saved in the meantime.
