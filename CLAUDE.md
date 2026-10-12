# ez4 (Gaio fork)

Release rules: `RELEASING.md`. Merging the release PR on `main` publishes `v<version>` to CodeArtifact.

## Branches and Releases

- Branch from `main` and open the PR against `main`. **NEVER** commit or push to `main` directly
- A PR that changes a published `@ez4/*` package adds a changeset; a major needs a `Breaking:` line saying what consumers must change
- A package change that must not release adds `npx changeset add --empty`; CI, docs, test workspaces and examples need none
- Every push to `main` keeps the release PR `release/main` → `main` (CI runs `npm run version-packages` on it). Release only when asked: squash-merge that PR; **NEVER** push to its branch
- **NEVER** run `changeset version`, `npm run release`, `npm publish` or create `v*` tags by hand: the workflows do it

## Specs

- A `providers/aws/*` spec that needs real AWS (deploys, or calls a client it doesn't mock) is named `<name>.lab.spec.ts`. Every other spec runs in CI through the package's `test:offline`, with AWS out of reach; `npm test` runs both, the lab ones against `local.env` (see `RELEASING.md`)

## TypeScript

- `tsc` in every script is TypeScript 7 (`@typescript/native`). It only emits declarations: the published JavaScript comes from esbuild (each package's `tools/bundler.mjs`), so the compiler version never changes runtime code.
- The root `typescript` is `@typescript/typescript6`, the 6.0 API that typescript-eslint needs. `@ez4/reflection` declares the real `typescript` 6 as a dependency and keeps using its API at runtime.
