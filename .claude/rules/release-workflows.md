---
paths:
  - '.github/workflows/**'
  - '.github/actions/**'
  - '.changeset/**'
description: |
  Release workflow rules: tree gate, release branch, deploy/publish safety, local checks.
---

# Release Workflow Rules

- A stage after the PR never reruns a suite for a tree with a passing `Tested tree` status: keep the `gate` → `suite`/`record` jobs and record the tree after every full suite
- `.github/actions/tree-gate` and `.github/actions/changeset-release` are byte-identical in ez4, computron, gaio-backend and gaio-frontend: change all four together
- Release, deploy and publish jobs use `cancel-in-progress: false` and no `timeout-minutes`
- Every bot push uses `GITHUB_TOKEN` and starts no workflow: the `develop` run that pushes `changeset-release/develop` also tests it, records its tree and deploys it. Versions are made on the release branch or a hotfix branch; no job commits to `main` or `develop`
- Validate every workflow change with `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest` and an `act -n` dry run per event (commands in `RELEASING.md`); never run release jobs for real with `act`
