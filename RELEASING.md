# Releasing the Gaio line of ez4

This fork publishes `@ez4/*` to Gaio's private CodeArtifact repository. The backend and the frontend
install from there. Releases are driven by [changesets](https://github.com/changesets/changesets):
merging the release pull request publishes to CodeArtifact on its own.

CI and release logic is a copy of [`Gaio-AI/gaio-actions`](https://github.com/Gaio-AI/gaio-actions)
at its `feat(validated): restore and save configured build outputs across runs (#11)` commit (`6626133`): `.github/workflows/gaio-*.yml` and `.github/gaio-actions/`. ez4 is public and
gaio-actions is private, and GitHub does not let a public repo call a private repo's workflows.
To update the copy, take the workflows and the actions' `action.yml` and `.mjs` files (no tests)
from a gaio-actions commit, rewrite `Gaio-AI/gaio-actions/<action>@v1` to
`./.github/gaio-actions/<action>` and `Gaio-AI/gaio-actions/.github/workflows/<name>.yml@v1` to
`./.github/workflows/gaio-<name>.yml`, and update the commit above. This repo keeps two thin
callers (`.github/workflows/pr.yml`, `.github/workflows/release.yml`) and its commands in
`.github/gaio-ci.json`.

## Flow

1. `main` is the only long-lived branch. Work branches start from `main` and open their pull request
   against `main`. Protected: no direct pushes, no force pushes.
2. Every pull request that changes a published package carries a changeset.
3. Pull requests merge by squash. The required check is the `Tested tree` status, posted once every PR check passes. The branch must be up to date
   with `main` before merge (**Update branch**), so the tested tree is the tree that lands.
4. A push to `main` with pending changesets rebuilds `release/main` (`main` plus
   `npm run version-packages`) and opens or updates the release pull request `release/main` → `main`
   (title `chore(release): ...`). Nothing publishes at this step.
5. A person reviews the release pull request and squash-merges it. That is the only way to release.
6. The push of that merge sees that `v<version>` (the version of `foundation/utils/package.json`) has
   no tag, runs `npm run release` in the `production` environment, then tags `v<version>` and creates
   its GitHub Release. There is no demo stage.

Changes that touch no published package (this file, CI, repository tooling) need no changeset, since
there is nothing to release. The `changeset` job fails any other pull request without one; a package
change that must not release adds `npx changeset add --empty`. An empty changeset releases nothing: it
waits and goes out with the next release.

Remotes: `origin` is `Gaio-AI/ez4`, `upstream` is `sbalmt/ez4`. The fork follows its own line and
does not track or rebase onto upstream: `upstream` is there to read, and a change worth having is
taken on its own (see [Taking a change from upstream](#taking-a-change-from-upstream)). In a fork
`gh` resolves to the parent repository unless told otherwise: run `gh repo set-default Gaio-AI/ez4`
once, or pass `-R Gaio-AI/ez4`.

## Every published version has a tag

This is the one rule that matters. Upstream publishes per-package patches with no release commit —
`aws-queue`, `aws-common`, `pgmigration` and `raw-pg` went to `0.53.1` and `local-topic` to `0.53.2`
without a single commit saying so. Anyone basing work on the release commit alone silently regresses
those packages, which is exactly what happened to this fork on its first day.

So: **a version is published only from the commit that gets its tag.** If there is no `v<version>`
tag, that version is not done. The Release workflow uses the same rule the other way around: a
version on `main` without its tag is a version still to publish, and the tag is created only after
`npm run release` succeeds at that commit.

## Semantic versions

From `1.0.0` on the version says what kind of change a release carries, and the backend and the
frontend depend on `^1.0.0`:

- **patch** — a fix.
- **minor** — a feature, a new opt-in option, or a behaviour change every consumer keeps working with.
- **major** — a consumer has to change code or configuration to take it.

A caret range takes every patch and minor, so a consumer adopts one by changing its lockfile alone and
goes back by reverting it. A major is the one release a consumer takes by editing its ranges on
purpose, every `@ez4/*` range in the same pull request: mixed ranges trip
`ProviderVersionMismatchError`.

A `major` changeset fails the pull request (`npm run changeset:check`) unless its summary has a line
starting with `Breaking:` that says what a consumer must change, and `npm run version-packages` runs the
same check when the release PR is built. The line goes into the release pull request with the rest of
the summary, so whoever takes the major reads there what to change.

Whatever the bump, a release is still validated as one batch with one recipe (step 3 of
[Releasing](#releasing)).

## Releasing

1. Add a changeset to the pull request that changes a package:

   ```bash
   npx changeset   # pick any package, and the bump the change needs
   ```

   Every published package and `extensions/vscode` move in lockstep (`fixed` in
   `.changeset/config.json`), so which package the changeset names only matters for the summary.
   Lockstep is not tidiness: ez4 refuses to load providers whose declared `@ez4/*` versions are not
   the same string (`ProviderVersionMismatchError`).

2. Changesets wait on `main`. Every push to `main` runs `release.yml`, which rebuilds `release/main`
   and its pull request with the next version. A minor or a major also moves every internal `@ez4/*`
   range to the new version (`updateInternalDependencies`).

3. Validate the batch on `main` before merging the release pull request. A release carries a small
   batch, and what goes together is decided by **what the change can break**, because that decides how
   it is validated:

   - **Deploy-time behaviour only** — plan output, guards, what the deploy sends to AWS: plan every
     consumer package with `main` and compare against the current version.
   - **The runtime client** — ORM, drivers, queue and topic clients: the consumer's full test suite
     and type check on `main`, then a deploy to `dev`.
   - **The migration engine**: the lab account, against a table large enough to hit the Data API
     limits.
   - **Something new and opt-in**: the lab account.

   One recipe per batch. A batch that needs two recipes is two batches. To install `main` in a
   consumer, publish it to the local registry (`npm run local:registry`, then `npm run local:publish`)
   and take **every** `@ez4/*` dependency at that version: mixing versions trips
   `ProviderVersionMismatchError`.

   `aws codeartifact login` points the `@ez4` scope at CodeArtifact in `~/.npmrc`, and a scope's
   registry wins over `--registry`. That is why `local:publish` names the scope, and the consumer has
   to name it too. Check that the version reached the local registry, then install it from there:

   ```bash
   npm view @ez4/utils versions --@ez4:registry=http://localhost:4873/
   npm update $(ls node_modules/@ez4 | sed 's#^#@ez4/#') --@ez4:registry=http://localhost:4873/
   ```

   The consumer's lockfile then resolves from the local registry: it serves the validation, and the
   consumer takes the version for real only once it is published.

4. Merge the release pull request with squash. The push of the merge publishes every public workspace
   to CodeArtifact under `latest` (`npm run release`, which skips what is already in the registry),
   then tags `v<version>` and creates the GitHub Release. No job commits to `main`.

5. Consumers take the version through their own pull requests: a lockfile update for a patch or a
   minor, every `@ez4/*` range together for a major.

An urgent fix is an ordinary pull request into `main` with a changeset, followed by merging the release
pull request it produces.

A published version is immutable. A mistake means publishing the next one.

## What CI covers

`.github/workflows/pr.yml` calls `.github/workflows/gaio-pr.yml` on `pull_request` (drafts
skipped) and on `workflow_dispatch` (`force` ignores the validated manifest). The release workflow
dispatches it on `release/main`, since a pull request opened with `GITHUB_TOKEN` starts no
`pull_request` run.

- `changeset` (pull requests only): `npm run changeset:check` (the `Breaking:` rule), then
  `changeset status --since=origin/<base>`.
- `lint`: `npm run build && npm run lint && node --test scripts/ci-config.test.mjs`.
- `tasks`: one `test` leg per workspace listed in the task's `packages` (foundation, contracts,
  `pgsql`/`pgclient`/`pgmigration`, `local-*` and `docs-gateway`/`docs-database`/`docs-topology`),
  with Postgres 16 on `:5432`, DynamoDB local 3.3.0 on `:8000` and Valkey 8 on `:6379`, and the AWS
  secrets in the environment. Each leg runs `npm run build` and `npm link -w @ez4/project`, then
  `npm test -w <package>`.
- A task whose content hash already passed is skipped, and a passing run posts `Tested tree` on the
  head commit, so `release.yml` on `main` does not test the same tree again.

CI does **not** run the specs under `providers/aws/*`, `tests/*` or `examples/*`: run the ones for the
packages a change touches before merging the release pull request, against the lab account where they
need real AWS.

## `.github/gaio-ci.json`

| Field | Meaning |
|---|---|
| `codeartifact` | Log in to CodeArtifact (`@ez4` namespace) before installing. |
| `deploy-doppler` | `false`: publishing needs no Doppler. |
| `changeset` | Pull request changeset check, `Breaking:` rule included; `{base}` is the base branch. |
| `lint` | One root-level task. |
| `shared-inputs` | Files whose change invalidates every task hash. |
| `ignore` | Paths that alone run no lint or task. A PR that changes anything under `.changeset/` always runs the changeset check; a changeset-only PR keeps lint and tasks hash-skipped. |
| `tasks` | The `test` leg per workspace described above. |
| `services` | Containers started for every task leg. |
| `apps` | One release unit, `ez4`: `foundation/utils` carries the version, tagged `v{version}`, no demo, published by `npm run release`. |
| `version` | Command that consumes the changesets. |

`scripts/ci-config.test.mjs` checks this file and the callers (`node --test scripts/ci-config.test.mjs`).

## Secrets

| Repo secret | Workflow secret | Used by |
|---|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | `aws-access-key-id`, `aws-secret-access-key`, `aws-region` | CodeArtifact login, the test legs and `npm run release` |

## Recovery

When the publish fails after the release pull request merged, the version is on `main` without its tag.

- Re-run with **Re-run failed jobs** on the same run: `npm run release` skips the packages already
  published, and the tag job skips a tag that exists.
- The next push to `main` retries while `v<version>` is missing.

## Validating workflow changes

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest
node --test scripts/ci-config.test.mjs
```

Never run `release.yml` for real with `act`: it pushes `release/main`, opens the release pull request,
publishes to CodeArtifact and creates tags.

## Cut-over

Steps for a repository admin, in order. `main` receives the gaio-actions callers first; `develop` is
drained later through a normal pull request, so nothing publishes until someone merges the release
pull request.

1. Settings → Actions → General: "Allow GitHub Actions to create and approve pull requests" stays
   enabled, so the release workflow can open the release pull request.
2. The `main` ruleset requires the `Tested tree` status, never `ci / checks` (the release pull request's dispatched run is not attached to it), squash merges only,
   and branches up to date before merge, with no bypass actor. Any ruleset written against
   `~DEFAULT_BRANCH` names `refs/heads/main` explicitly.
3. Merge the pull request that adds the gaio-actions callers to `main`. `main` has no pending changeset
   and `v<version>` is already tagged, so the merge publishes nothing. The first `release.yml` run
   creates the `production` environment.
4. Freeze `develop`: new pull requests target `main` from here on. Close the open
   `changeset-release/develop` pull request and delete its branch.
5. Settings → General → Default branch = `main`, then retarget the open pull requests:
   ```bash
   gh pr list --base develop --state open --json number --jq '.[].number' | xargs -I{} gh pr edit {} --base main
   ```
6. In the hall `ivar.json`, set ez4 `default_branch` to `main`, then run `ivar sync`.
7. When `develop`'s changesets should ship, open a pull request from `develop` into `main` and merge it.
   The release workflow opens the release pull request, and merging that publishes.
8. Delete `develop` and its ruleset.

## Taking a change from upstream

Upstream is read for ideas, one change at a time, from the `upstream` remote (`git fetch upstream`).
`cherry-pick` usually conflicts, since the two lines diverged. When the file differs only by the fix,
take the file:

```bash
git diff --stat <our-base> <commit>^ -- <file>   # empty means only the fix separates them
git checkout <commit> -- <file>
```

Keep the original author with `git commit --author`. When our side of the file has changed too, port
the change by hand and name the upstream commit in the pull request.
