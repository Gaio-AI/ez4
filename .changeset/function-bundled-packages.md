---
'@ez4/aws-common': patch
'@ez4/aws-function': patch
---

Redeploy a Lambda function when a package it bundles from `node_modules` changes version, such as a library patched by a lockfile bump or an `@ez4` runtime fix, which the source hash missed because it follows only the declarations of a package. Each function now records the packages in its bundle with their versions, and the plan shows `packagesHash` when an installed version differs; the function is rebundled and its code is uploaded only if the bundle bytes changed. The first deploy with this version shows `packagesHash` as new on every function and rebundles each of them once, uploading only the ones whose bundle differs from the deployed code. A change to a package's code under the same version is not detected.
