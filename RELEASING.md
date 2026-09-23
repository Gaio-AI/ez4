# Releasing the Gaio line of ez4

This fork publishes `@ez4/*` to Gaio's private CodeArtifact repository. The backend and the frontend
install from there. Releases are driven by [changesets](https://github.com/changesets/changesets):
merging the release pull request publishes to CodeArtifact on its own.

## Branches

- **`main`** — every change lands here through a pull request, each one carrying a changeset when it
  touches a published package. A commit on `main` is published only when it carries a `v<version>`
  tag. Protected: no direct pushes, no force pushes.
- **`changeset-release/main`** — the release branch. The Release workflow keeps it, and its pull
  request (`chore: version packages`), up to date with every changeset waiting on `main`. Never push
  to it by hand.
- **`upstream-main`** — mirrors `sbalmt/ez4`. Kept only so we can diff against upstream and pick
  changes from it. Never develop here.
- Work happens on `fix/*` or `feat/*`, opened against `main` and merged with a squash: one commit per
  change.

Changes that touch no published package — this file, CI, repository tooling — need no changeset,
since there is nothing to release.

Remotes: `origin` is `Gaio-AI/ez4`, `upstream` is `sbalmt/ez4`. In a fork `gh` resolves to the parent
repository unless told otherwise: run `gh repo set-default Gaio-AI/ez4` once, or pass
`-R Gaio-AI/ez4`.

## Every published version has a tag

This is the one rule that matters. Upstream publishes per-package patches with no release commit —
`aws-queue`, `aws-common`, `pgmigration` and `raw-pg` went to `0.53.1` and `local-topic` to `0.53.2`
without a single commit saying so. Anyone basing work on the release commit alone silently regresses
those packages, which is exactly what happened to this fork on its first day.

So: **a version is published only from a commit that carries its tag.** If there is no `v<version>`
tag, that version does not exist. The Release workflow uses the same rule the other way around: a
version on `main` without its tag is a version still to publish.

## Only patches

The fork never goes above upstream's minor. While upstream is on `0.54`, every release of ours is a
`0.54` patch: a caret range on a `0.x` version stops at the minor, so the backend and the frontend
take any of them by changing their lockfile alone, and go back by reverting it. A consumer change
that works with both versions can land first to make that true: `0.53.904` typed Postgres reads as
`T | null`, and the backend was fixed to compile against both sets of types before a lockfile-only
pull request took the version.

A `minor` or `major` changeset fails the pull request (`npm run changeset:check`), and the release
workflow refuses to version it too. A change that would need consumers to change code or
configuration in the same step waits until it can be made compatible, or rides the next upstream
minor.

Patch numbers start at `900` on each minor, clear of the patches upstream publishes on its own
(`0.53.1`, `0.53.2`).

## Releasing

1. Add a changeset to the pull request that changes a package:

   ```bash
   npx changeset   # pick any package, always `patch`
   ```

   Every published package and `extensions/vscode` move in lockstep (`fixed` in
   `.changeset/config.json`), so which package the changeset names only matters for the summary.
   Lockstep is not tidiness: ez4 refuses to load providers whose declared `@ez4/*` versions are not
   the same string (`ProviderVersionMismatchError`).

2. Once the pull request merges and the suite passes on `main`, the Release workflow opens or updates
   the release pull request from `changeset-release/main`, with every package bumped to the next
   patch and the lockfile relinked.

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

4. Merge the release pull request with a **merge commit**, not a squash, so each change keeps its own
   commit on `main`: it can be bisected, and `git merge-base --is-ancestor` tells the truth about what
   a version contains.

5. The suite runs on the merge commit and, when it passes, the Release workflow cleans, builds and
   publishes every public workspace to CodeArtifact under `latest` (`npm run release`), tags the
   commit `v<version>` and creates the GitHub release with generated notes. A failed publish can be
   re-run: packages already in the registry at that version are skipped.

A published version is immutable. A mistake means publishing the next one.

### Adopting an upstream minor

The one version change that is not a changeset. When upstream moves to a new minor and we take it,
bump everything by hand to our first patch of that minor, in a pull request against `main`:

```bash
npm version <minor>.900 --workspaces --no-workspaces-update --no-git-tag-version --allow-same-version
git checkout -- examples/ tests/
npm install   # relinks the workspaces at the new version
```

Without `--no-workspaces-update`, `npm version` reinstalls right after the bump, before the
`checkout`, and fails with a 404 on `hello-aws-gateway`. The `checkout` is not optional: packages
under `examples/` reference each other with `^0.0.0`, and the bump breaks their resolution. Move every
`@ez4/*` range to the new minor, here — including the exact pins in `extensions/vscode` — and in the
consumers, in the same step: nobody takes a minor by accident. Merging it publishes the version, since
it has no tag yet.

## What CI covers

The pull request workflow builds everything, lints, and tests the foundation, the contracts, the
libraries and the local and docs providers. It skips drafts, so a pull request has only been checked
once it is marked ready. It does **not** run the specs under `providers/aws/*`: run the ones for the
packages a change touches before merging the release pull request, against the lab account where they need
real AWS.

## Taking a change from upstream

`cherry-pick` usually conflicts: the upstream `v0.54.0` branch diverged from our base. Check that the
file differs only by the fix, then take the file:

```bash
git diff --stat <our-base> <commit>^ -- <file>   # empty means only the fix separates them
git checkout <commit> -- <file>
```

Keep the original author with `git commit --author`.
