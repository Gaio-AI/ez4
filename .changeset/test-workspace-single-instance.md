---
'@ez4/project': patch
---

Within a test run, a workspace package whose entry is TypeScript source is again one instance, shared by the specs and the handlers a tester runs, as it was before 2.13.0. A spec that mocks one of its exports (`t.mock.method(Logger, 'log')` on a package of the workspace) reaches the handler that `Tester.request` runs again. Project modules keep their `?v=0` graph apart from the modules the specs import, and a serve reload still loads the package again.
