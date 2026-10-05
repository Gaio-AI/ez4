---
'@ez4/state': patch
---

Keep an entry in the state while an entry kept there by a failure still depends on it, and save an unchanged entry with its current dependencies (skipping it like a changed one when a dependency failed), so a failed step no longer leaves a state that every later deploy and destroy refuses to load.
