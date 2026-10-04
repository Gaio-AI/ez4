# Releasing the Gaio line of ez4

This fork publishes `@ez4/*` to Gaio's private CodeArtifact repository. The backend and the frontend
install from there. Releases are driven by [changesets](https://github.com/changesets/changesets):
merging the release pull request publishes to CodeArtifact on its own.

## Branches

- **`main`** — every change lands here through a pull request, each one carrying a changeset when it
  touches a published package. A commit on `main` is published only when it carries a `v<version>`
  tag. Protected: no direct pushes, no force pushes.
- **`changeset-release/main`** — the release branch. The Release workflow keeps it, and its pull
  request (`chore: version <version>`), up to date with every changeset waiting on `main`. Never push
  to it by hand.
- Work happens on `fix/*` or `feat/*`, opened against `main` and merged with a squash: one commit per
  change.

Changes that touch no published package — this file, CI, repository tooling — need no changeset,
since there is nothing to release. The `🦋 Changeset` job fails any other pull request into `main`
without one; a package change that must not release adds `npx changeset add --empty`. An empty
changeset opens no release pull request: it waits on `main` and goes out with the next release.

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
starting with `Breaking:` that says what a consumer must change, and the release workflow runs the same
check before versioning. The line goes into the release pull request with the rest of the summary, so
whoever takes the major reads there what to change.

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

2. Once the pull request merges and the suite passes on `main`, the Release workflow opens or updates
   the release pull request from `changeset-release/main`, with every package bumped by the largest
   bump among the changesets waiting and the lockfile relinked. A minor or a major also moves every
   internal `@ez4/*` range to the new version (`updateInternalDependencies`).

3. Validate the batch before merging the release pull request. A release carries a small batch, and
   what goes together is decided by **what the change can break**, because that decides how it is
   validated:

   - **Deploy-time behaviour only** — plan output, guards, what the deploy sends to AWS: plan every
     consumer package with the release branch and compare against the current version.
   - **The runtime client** — ORM, drivers, queue and topic clients: the consumer's full test suite
     and type check on the release branch, then a deploy to `dev`.
   - **The migration engine**: the lab account, against a table large enough to hit the Data API
     limits.
   - **Something new and opt-in**: the lab account.

   One recipe per batch. A batch that needs two recipes is two batches. To install the release branch
   in a consumer, publish it to the local registry (`npm run local:registry`, then
   `npm run local:publish`) and take **every** `@ez4/*` dependency at that version: mixing versions
   trips `ProviderVersionMismatchError`.

   `aws codeartifact login` points the `@ez4` scope at CodeArtifact in `~/.npmrc`, and a scope's
   registry wins over `--registry`. That is why `local:publish` names the scope, and the consumer has
   to name it too. Check that the version reached the local registry, then install it from there:

   ```bash
   npm view @ez4/utils versions --@ez4:registry=http://localhost:4873/
   npm update $(ls node_modules/@ez4 | sed 's#^#@ez4/#') --@ez4:registry=http://localhost:4873/
   ```

   The consumer's lockfile then resolves from the local registry: it serves the validation, and the
   consumer takes the version for real only once it is published.

4. Merge the release pull request with a **merge commit**, not a squash, so each change keeps its own
   commit on `main`: it can be bisected, and `git merge-base --is-ancestor` tells the truth about what
   a version contains.

5. The suite runs on the merge commit and, when it passes, the Release workflow cleans, builds and
   publishes every public workspace to CodeArtifact under `latest` (`npm run release`), tags the
   commit `v<version>` and creates the GitHub release with generated notes. A failed publish can be
   re-run: packages already in the registry at that version are skipped.

A published version is immutable. A mistake means publishing the next one.

## What CI covers

The pull request workflow builds everything, lints, and tests the foundation, the contracts, the
libraries and the local and docs providers. It skips drafts, so a pull request has only been checked
once it is marked ready. It does **not** run the specs under `providers/aws/*`: run the ones for the
packages a change touches before merging the release pull request, against the lab account where they need
real AWS.

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
