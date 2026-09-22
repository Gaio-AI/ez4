# Releasing the Gaio line of ez4

This fork publishes `@ez4/*` to Gaio's private CodeArtifact repository. The backend and the frontend
install from there.

## Branches

- **`main`** — what is published. It only moves through a release pull request, so every commit on
  it between two tags is a version someone can install. Protected: no direct pushes, no force pushes.
- **`release/<version>`** — one batch of changes on its way to becoming `<version>`. Cut from `main`,
  merged back into `main` when the batch is validated.
- **`upstream-main`** — mirrors `sbalmt/ez4`. Kept only so we can diff against upstream and pick
  changes from it. Never develop here.
- Work happens on `fix/*` or `feat/*`, opened against the **release branch** and merged with a
  squash: one commit per change.

Changes that touch no published package — this file, CI, repository tooling — are opened against
`main` directly, since there is nothing to release.

Remotes: `origin` is `Gaio-AI/ez4`, `upstream` is `sbalmt/ez4`. In a fork `gh` resolves to the parent
repository unless told otherwise: run `gh repo set-default Gaio-AI/ez4` once, or pass
`-R Gaio-AI/ez4`.

## Every published version has a tag

This is the one rule that matters. Upstream publishes per-package patches with no release commit —
`aws-queue`, `aws-common`, `pgmigration` and `raw-pg` went to `0.53.1` and `local-topic` to `0.53.2`
without a single commit saying so. Anyone basing work on the release commit alone silently regresses
those packages, which is exactly what happened to this fork on its first day.

So: **a version is published only from a commit that carries its tag.** If there is no `v<version>`
tag, that version does not exist. This holds for release candidates too.

## Batches

A release carries a small batch, not a single pull request and not everything that is ready. What
goes together is decided by **what the change can break**, because that is what decides how the
batch gets validated:

- **Deploy-time behaviour only** — plan output, guards, what the deploy sends to AWS: plan every
  consumer package with the candidate and compare against the current version.
- **The runtime client** — ORM, drivers, queue and topic clients: the consumer's full test suite and
  type check on the candidate, then a deploy to `dev`.
- **The migration engine**: the lab account, against a table large enough to hit the Data API limits.
- **Something new and opt-in**: the lab account.

One recipe per batch. A batch that needs two recipes is two batches.

## Cutting a release

1. Cut the branch from `main`:

   ```bash
   git switch -c release/<version> origin/main
   git push -u origin release/<version>
   ```

2. Merge the batch into it through pull requests.
3. Publish a **release candidate** from the release branch. Bump every publishable package in
   lockstep to `<version>-rc.<n>`:

   ```bash
   npm version <version>-rc.<n> --workspaces --no-git-tag-version --allow-same-version
   git checkout -- examples/ tests/
   npm install   # relinks the workspaces at the new version
   ```

   The `checkout` is not optional: packages under `examples/` reference each other with `^0.0.0`, and
   the bump breaks their resolution.

   **`extensions/vscode` stays bumped**, and its `@ez4/*` dependencies — pinned to an *exact*
   version, not a range — have to be rewritten to the new one along with it. Left behind, npm stops
   resolving them to the workspace and the build fails with `Could not resolve "@ez4/utils"`. If a
   stale `extensions/vscode/node_modules` survives from an earlier attempt, delete it: it shadows
   the workspace links.

   Lockstep matters beyond tidiness — ez4 refuses to load providers whose declared `@ez4/*` versions
   are not the same string (`ProviderVersionMismatchError`).

   `npm run build`, commit as `chore: version <version>-rc.<n>`, tag that commit
   `v<version>-rc.<n>`, push the tag, and publish under the `next` dist-tag so `latest` does not move:

   ```bash
   aws codeartifact login --tool npm --domain gaio --repository npm --namespace ez4
   npm publish --workspace @ez4/<package> --access public --tag next
   ```

4. Validate the candidate in the consumer with the batch's recipe. The consumer has to pin **every**
   `@ez4/*` dependency to the exact candidate: a range like `^0.53.0` never resolves to a
   pre-release, and mixing the candidate with the range trips `ProviderVersionMismatchError`.
   Anything found goes back to step 2 and out again as `rc.<n+1>`.
5. Bump to the final `<version>` the same way, commit as `chore: version <version>`, and open the
   release pull request into `main`. Merge it with a **merge commit**, not a squash: each change keeps
   its own commit on `main`, so it can be bisected and `git merge-base --is-ancestor` tells the truth
   about what a version contains. Upstream squashes its version branches, so there a whole version
   is a single commit and a fix is never an ancestor of the version that ships it.
6. Tag the merge commit `v<version>`, push the tag and publish without `--tag`.
7. Write the release notes from the tag, `gh release create v<version> --generate-notes`, and delete
   the release branch.

A published version is immutable. A mistake means publishing the next one — which is what the
candidates are for.

### Hotfix

A release branch with one change in it: cut `release/<version>` from `main`, fix, candidate if the
fix warrants one, release. A batch already in flight rebases onto `main` afterwards and takes the
next version number, so the numbers in an open release branch are tentative until it merges.

### Patching a single package

Allowed, and it still needs its own tag — see `v0.53.902`, which carries only `@ez4/utils`. Say so in
the tag message.

## What CI covers

The pull request workflow builds everything, lints, and tests the foundation, the contracts, the
libraries and the local and docs providers. It skips drafts, so a pull request has only been checked
once it is marked ready. It does **not** run the specs under `providers/aws/*`: run the ones for the
packages a batch touches before publishing its candidate, against the lab account where they need
real AWS.

## Taking a change from upstream

`cherry-pick` usually conflicts: the upstream `v0.54.0` branch diverged from our base. Check that the
file differs only by the fix, then take the file:

```bash
git diff --stat <our-base> <commit>^ -- <file>   # empty means only the fix separates them
git checkout <commit> -- <file>
```

Keep the original author with `git commit --author`.
