# ez4 (Gaio fork)

Release rules: `RELEASING.md`. Merging the release PR on `main` publishes `v<version>` to CodeArtifact.

## Branches and Releases

- Branch from `main` and open the PR against `main`. **NEVER** commit or push to `main` directly
- A PR that changes a published `@ez4/*` package adds a changeset; a major needs a `Breaking:` line saying what consumers must change
- A package change that must not release adds `npx changeset add --empty`; CI, docs, test workspaces and examples need none
- Every push to `main` keeps the release PR `release/main` → `main` (CI runs `npm run version-packages` on it). Release only when asked: squash-merge that PR; **NEVER** push to its branch
- **NEVER** run `changeset version`, `npm run release`, `npm publish` or create `v*` tags by hand: the workflows do it
