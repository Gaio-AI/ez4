---
'@ez4/project': patch
---

A service declared in the project whose contract no installed package reads now stops the deploy with an error naming the service and the package, instead of being left out of it. Contracts and providers are found through the project's `@ez4/*` dependencies, while the declaration compiles with any package the workspace installs, so a service missing `@ez4/scheduler` and `@ez4/aws-scheduler` from `package.json` used to vanish from the plan and the deploy succeeded. The check covers every class that extends a contract service or import (all of them implement `Service.Provider` from `@ez4/common`). `ez4 deploy`, `generate`, `run` and `test` stop on it, and `ez4 serve` logs it on every reload.
