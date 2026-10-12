---
'@ez4/project': patch
---

`ez4 test` takes exclusion patterns: a pattern after `--` that starts with `!` drops the test files whose path contains the rest of it, after the other patterns pick theirs (none picks every test file). `ez4 test -- '!.lab.spec'` runs every spec except the `*.lab.spec.ts` ones.
