# ez4 (Gaio fork)

Release rules: `RELEASING.md`. `main` publishes `v<version>` to CodeArtifact; `develop` publishes nothing.

## Branches and Releases

- Branch from `develop` and open the PR against `develop`. **NEVER** commit or push to `develop` or `main` directly
- A PR that changes a published `@ez4/*` package adds a changeset; a major needs a `Breaking:` line saying what consumers must change
- A package change that must not release adds `npx changeset add --empty`; CI, docs, test workspaces and examples need none
- Every push to `develop` keeps the release PR `changeset-release/develop` → `main` (CI merges `main`, runs `changeset version`, tests it). Release only when asked: merge that PR with a merge commit (never squash); **NEVER** push to its branch
- Hotfix only when asked: `hotfix/<name>` from `main`, add a changeset, run `npm run version-packages`, PR into `main`. `main` reaches `develop` only through a `sync/<name>` branch from `develop` that merges `main`, merged with a merge commit
- **NEVER** run `changeset version` outside a hotfix branch, `npm publish` or create `v*` tags by hand: the workflows do it
