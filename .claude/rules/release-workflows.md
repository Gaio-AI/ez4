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
- The release commit, tags and back-merge merge are pushed with the `gaio-code-agent` App token and start workflows: the App's push to `main` stops at `🔎 Tested tree`, and the tree gate decides a back-merge on `develop`. Every other bot push (`staging`, `refs/deploy/*`) uses `GITHUB_TOKEN` and starts nothing
- Validate every workflow change with `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest` and an `act -n` dry run per event (commands in `RELEASING.md`); never run release jobs for real with `act`
