# Releasing the Gaio line of ez4

This fork publishes `@ez4/*` to Gaio's private CodeArtifact repository. The backend and the frontend
install from there. Releases are driven by [changesets](https://github.com/changesets/changesets):
merging the release pull request publishes to CodeArtifact on its own.

## Branches

- **`develop`** — every change lands here through a pull request, merged with a squash: one commit per
  change. Nothing publishes from `develop`.
- **`main`** — published versions only. Receives the release pull request
  `changeset-release/develop → main` merged with a merge commit, and `hotfix/*` pull requests. A
  commit on `main` is published only when it carries a `v<version>` tag. Protected: no direct pushes,
  no force pushes.
- **`changeset-release/develop`** — rebuilt by every push to `develop`: `develop` merged with `main`
  plus `changeset version`, force-pushed by CI (`GITHUB_TOKEN`) and opened or updated as the release
  pull request into `main`. Nobody pushes to it: the next push to `develop` replaces it.
- **`hotfix/<name>`** — branched from `main` for an urgent fix to a published version: add a changeset,
  run `npm run version-packages`, commit, then open against `main` and merge with a merge commit or
  squash.
- **`sync/<name>`** — branched from `develop` to merge `main` into `develop` by hand: resolve
  conflicts, open against `develop`, merge with a merge commit (never squash).

Changes that touch no published package — this file, CI, repository tooling — need no changeset,
since there is nothing to release. The `🦋 Changeset` job fails any other pull request into `develop`
without one; a package change that must not release adds `npx changeset add --empty`. An empty
changeset releases nothing: it waits and goes out with the next release.

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

So: **a version is published only from a commit that carries its tag.** If there is no `v<version>`
tag, that version does not exist. The Release workflow uses the same rule the other way around: a
version on `main` without its tag is a version still to publish.

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
same check when the release branch is built. The line goes into the release pull request with the rest of
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

2. Changesets wait on `develop`. Every push to `develop` runs `release.yml`: `🌿 Release branch`
   rebuilds `changeset-release/develop` (`develop` + a merge of `main` + `changeset version`),
   force-pushes it with `GITHUB_TOKEN` and opens or updates its pull request into `main` (title
   `release v<version>`). A minor or a major also moves every internal `@ez4/*` range to the new version
   (`updateInternalDependencies`).

3. Validate the batch on `develop` before merging the release pull request. A release carries a small
   batch, and what goes together is decided by **what the change can break**, because that decides how
   it is validated:

   - **Deploy-time behaviour only** — plan output, guards, what the deploy sends to AWS: plan every
     consumer package with `develop` and compare against the current version.
   - **The runtime client** — ORM, drivers, queue and topic clients: the consumer's full test suite
     and type check on `develop`, then a deploy to `dev`.
   - **The migration engine**: the lab account, against a table large enough to hit the Data API
     limits.
   - **Something new and opt-in**: the lab account.

   One recipe per batch. A batch that needs two recipes is two batches. To install `develop` in a
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

4. The release pull request `changeset-release/develop → main` is opened and updated by CI on every push
   to `develop` with pending changesets. With no pending releasing changeset there is no release pull
   request (CI closes an open one), the suite runs on `develop` itself. A passing `Tested tree` status
   on its head means the full suite ran and passed during that `develop` run. Merge the release pull
   request with **Create a merge commit** (never squash), so each change keeps its own commit on `main`.

5. On push to `main`, `release.yml` gates the tree (reusing the `Tested tree` status from the release
   branch or running the suite if untested), publishes every public workspace to CodeArtifact under
   `latest` (`npm run release`) when its `v<version>` tag is missing, tags `v<version>`, and creates
   the GitHub Release with generated notes. No job commits to `main` or `develop`. A failed run can be
   re-run: it publishes or tags only what is missing.

Hotfix: branched from `main` (`hotfix/<name>`), add a changeset, run `npm run version-packages`, and
commit. Open a pull request into `main` (CI checks branch policy, versioned check, lint, and full suite).
Merge with a merge commit or squash; merging releases to CodeArtifact and tags the commit. Afterwards
run `release.yml` on `develop` (Actions → Release → Run workflow) so the release pull request includes
the hotfix; otherwise the next push to `develop` does it.

Syncing `main` into `develop`: nothing merges `main` into `develop` automatically; the release branch
merges `main` on every rebuild. When that merge conflicts (or developers want `main`'s changes on
`develop`), create `sync/<name>` from `develop`, run `git merge origin/main`, resolve conflicts, open a
pull request into `develop`, and merge with **Create a merge commit** (never squash).

A published version is immutable. A mistake means publishing the next one.

## What CI covers

Pull requests into `develop` run changeset validation and linting only. `hotfix/*` pull
requests into `main` run the versioned check, linting, and every test leg (foundation,
contracts, libraries, local and docs providers) and record the `Tested tree` status.
`sync/*` pull requests skip the changeset job. Pushes to `develop` run the full suite on the
release branch head (or on `develop` when no release is pending) and record its tree.
The release pull request runs no CI of its own; pushes to `main` reuse the recorded
`Tested tree` status via the tree gate so a tested tree is never tested again. CI does
**not** run the specs under `providers/aws/*`: run the ones for the packages a change
touches before merging the release pull request, against the lab account where they need
real AWS.

## Switching to git flow (once)

1. Before merging the cutover PR, configure repository settings:
   - **Actions permissions:** Settings → Actions → General → Workflow permissions → select **Allow GitHub Actions to create and approve pull requests**.
   - **Rulesets:** a `main` ruleset (PR required, merge + squash, no force push) and a `develop` ruleset (PR required, squash + merge, no force push), with no bypass actors.
   - **Required check on `main`:** `Tested tree`, not `🧪 Tests`. The release pull request gets no pull request run, so only the `Tested tree` status that the `develop` run records on its head can satisfy it; a `hotfix/*` pull request records its own.
2. After the cutover PR is merged into `main`: `develop` already exists at the pre-cutover `main` and is not the default branch. Bring it up to `main` before anything merges into it, so it carries the new workflows: `git push origin origin/main:refs/heads/develop` by a repository admin (fast-forward), or a `sync/*` PR merged with a merge commit when the `develop` ruleset blocks the push.
3. Settings → General → Default branch: set to `develop` (new PRs and `gh pr create` target it; `main` stays the release branch).
4. Any ruleset written against `~DEFAULT_BRANCH` must name `refs/heads/main` explicitly before the switch.
5. Retarget open PRs:
   ```bash
   gh pr list --base main --state open --json number --jq '.[].number' | xargs -I{} gh pr edit {} --base develop
   ```
6. Close any open release pull request into `main` (if any) and delete its branch.
7. Verify workflows locally:
   ```bash
   docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest
   act pull_request -W .github/workflows/pull-requests.yml -e /path/to/pr-develop.json -n
   act pull_request -W .github/workflows/pull-requests.yml -e /path/to/pr-sync.json -n
   act pull_request -W .github/workflows/pull-requests.yml -e /path/to/pr-hotfix.json -n
   act push -W .github/workflows/release.yml -e /path/to/push-develop.json -n
   act push -W .github/workflows/release.yml -e /path/to/push-main.json -n
   ```

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
