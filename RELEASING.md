# Releasing the Gaio line of ez4

This fork publishes `@ez4/*` to Gaio's private CodeArtifact repository. The backend and the frontend
install from there.

## Branches

- **`gaio/main`** — our line. Protected: changes arrive through a pull request, no direct pushes, no
  force pushes.
- **`main`** — mirrors `sbalmt/ez4`. Kept only so we can diff against upstream and pick changes from
  it. Never develop here.
- Work happens on `fix/*` or `feat/*`, merged into `gaio/main` with a squash.

Remotes: `origin` is `Gaio-AI/ez4`, `upstream` is `sbalmt/ez4`.

## Every published version has a tag

This is the one rule that matters. Upstream publishes per-package patches with no release commit —
`aws-queue`, `aws-common`, `pgmigration` and `raw-pg` went to `0.53.1` and `local-topic` to `0.53.2`
without a single commit saying so. Anyone basing work on the release commit alone silently regresses
those packages, which is exactly what happened to this fork on its first day.

So: **a version is published only from a commit that carries its tag.** If there is no `v<version>`
tag, that version does not exist.

## Cutting a release

1. Merge the fixes into `gaio/main` through pull requests.
2. Bump every publishable package in lockstep:

   ```bash
   npm version <version> --workspaces --no-git-tag-version --allow-same-version
   git checkout -- examples/ tests/ extensions/vscode/package.json
   ```

   The `checkout` is not optional: packages under `examples/` reference each other with `^0.0.0`, and
   the bump breaks their resolution.

   Lockstep matters beyond tidiness — ez4 refuses to load providers whose declared `@ez4/*` versions
   are not the same string (`ProviderVersionMismatchError`).

3. `npm run build`, commit as `chore: version <version>`, open the PR, merge.
4. Tag the merged commit `v<version>` and push the tag.
5. Publish:

   ```bash
   aws codeartifact login --tool npm --domain gaio --repository npm --namespace ez4
   npm publish --workspace @ez4/<package> --access public
   ```

A published version is immutable. A mistake means publishing the next one.

### Patching a single package

Allowed, and it still needs its own tag — see `v0.53.902`, which carries only `@ez4/utils`. Say so in
the tag message.

## Taking a change from upstream

`cherry-pick` usually conflicts: the upstream `v0.54.0` branch diverged from our base. Check that the
file differs only by the fix, then take the file:

```bash
git diff --stat <our-base> <commit>^ -- <file>   # empty means only the fix separates them
git checkout <commit> -- <file>
```

Keep the original author with `git commit --author`.
