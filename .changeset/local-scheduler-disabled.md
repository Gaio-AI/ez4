---
'@ez4/local-scheduler': patch
---

`ez4 serve` honours `disabled` on a `Cron.Service`: a disabled scheduler no longer fires on its expression locally, as its deployed schedule never does, and still runs when invoked through its endpoint. `disabled: Environment.VariableOrValue<'NAME', false>` already resolves per stage at deploy, so one variable turns a scheduler off on the stages that set it.
