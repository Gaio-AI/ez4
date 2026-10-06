---
paths:
  - '.github/workflows/**'
  - '.github/actions/**'
  - '.changeset/**'
description: |
  Release workflow rules: tree gate, back-merge, deploy/publish safety, local checks.
---

# Release Workflow Rules

- A stage after the PR never reruns a suite for a tree with a passing `Tested tree` status: keep the `gate` → `suite`/`record` jobs and record the tree after every full suite
- `.github/actions/tree-gate` and `.github/actions/back-merge` are byte-identical in ez4, computron, gaio-backend and gaio-frontend: change all four together
- Release, deploy and publish jobs use `cancel-in-progress: false` and no `timeout-minutes`
- Pushes made with `GITHUB_TOKEN` (release commit, tags, back-merge) start no workflow; anything that must run after them is called or dispatched explicitly
- Validate every workflow change with `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest` and an `act -n` dry run per event (commands in `RELEASING.md`); never run release jobs for real with `act`
