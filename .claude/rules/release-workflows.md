---
paths:
  - '.github/workflows/**'
  - '.github/gaio-ci.json'
  - '.changeset/**'
description: |
  Release workflow rules: gaio-actions callers, CI config, publish safety, local checks.
---

# Release Workflow Rules

- CI and release logic lives in `Gaio-AI/gaio-actions@v1`; `.github/workflows/pr.yml` and `release.yml` stay thin callers. Change shared behaviour there, and only this repo's commands in `.github/gaio-ci.json`
- Callers map the secrets explicitly (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`); the release caller keeps `concurrency: release-main` with `cancel-in-progress: false`
- `apps` has one unit, `foundation/utils`, tagged `v{version}`, `demo: null`, published by `npm run release`; the tag is created only after the publish succeeds
- Every bot push uses `GITHUB_TOKEN`; only the release PR's squash merge publishes, and no job commits to `main`
- Validate every workflow or config change with `node --test scripts/ci-config.test.mjs` and `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest`; never run release jobs for real with `act`
