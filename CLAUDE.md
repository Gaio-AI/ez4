# ez4 (Gaio fork)

Release rules: `RELEASING.md`. `main` publishes `v<version>` to CodeArtifact; `develop` publishes nothing.

## Branches and Releases

- Branch from `develop` and open the PR against `develop`. **NEVER** commit or push to `develop` or `main` directly
- A PR that changes a published `@ez4/*` package adds a changeset; a major needs a `Breaking:` line saying what consumers must change
- A package change that must not release adds `npx changeset add --empty`; CI, docs, test workspaces and examples need none
- Release only when asked: PR `develop` → `main`, merged with a merge commit (never squash)
- Hotfix only when asked: `hotfix/<name>` from `main`, PR into `main`; the bot back-merges `main` into `develop`
- **NEVER** run `changeset version`, `npm publish` or create `v*` tags by hand: the workflows do it
