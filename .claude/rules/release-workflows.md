---
paths:
  - '.github/workflows/**'
  - '.github/gaio-ci.json'
  - '.changeset/**'
description: |
  Release workflow rules: gaio-actions callers, CI config, publish safety, local checks.
---

# Release Workflow Rules

- CI and release logic is a copy of `Gaio-AI/gaio-actions` (`.github/workflows/gaio-*.yml`, `.github/gaio-actions/`), since a public repo cannot call a private repo's workflows. Change shared behaviour in gaio-actions first and re-copy it as `RELEASING.md` describes; `.github/workflows/pr.yml` and `release.yml` stay thin callers, and this repo's commands live in `.github/gaio-ci.json`
- Callers assume the AWS roles through OIDC: `aws-role` from the `AWS_CI_ROLE` repository variable, `aws-deploy-role` (release only) from `AWS_PUBLISH_ROLE`, and map only the `AWS_REGION` secret; no access key goes back in. The release caller keeps `concurrency: release-main` with `cancel-in-progress: false`
- `apps` has one unit, `foundation/utils`, tagged `v{version}`, `demo: null`, published by `npm run release`; the tag is created only after the publish succeeds
- Every bot push uses `GITHUB_TOKEN`; only the release PR's squash merge publishes, and no job commits to `main`
- Validate every workflow or config change with `node --test scripts/ci-config.test.mjs` and `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest`; never run release jobs for real with `act`
