---
'@ez4/project': patch
'@ez4/logger': patch
---

`ez4 deploy --plan` and `ez4 destroy --plan` print the plan and exit, without the confirmation prompt, the deploy lock, the apply or a state save. The exit code tells the plan apart, as `terraform plan -detailed-exitcode` does: 0 without changes, 2 with changes and 1 on error. The plan check comes before the confirmation, so a project with `confirmMode: false` still stops at the plan. Before, the only way to see a plan was to run the deploy and answer `n`, a deploy command whose safety depended on the answer reaching the prompt.

A plan is meant to be compared with another one, so `--plan` drops the elapsed time from each step line. Colors follow the terminal: output that is not a terminal, such as a log file or a pipe, is plain text. `NO_COLOR` turns colors off and `FORCE_COLOR` turns them on (`FORCE_COLOR=0` off), whatever the output is.

An older `ez4` ignores `--plan` and goes on to deploy, so a script or CI job takes the flag only once its `@ez4/*` dependencies are at this version.
