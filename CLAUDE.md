# ez4 (Gaio line)

This is Gaio's own line of ez4. It started as a fork of `sbalmt/ez4` and does not follow it: nothing is merged, cherry-picked or kept compatible with upstream, and nothing is proposed back. Upstream is read for ideas and for the bugs it finds; what is worth having is written here like any other change. Never argue a choice from staying close to upstream.

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
- `@ez4/reflection` declares the real `typescript` 6 as a dependency and keeps using its API at runtime.

## Lint

- `npm run lint` lints every workspace's `src` in one run, after the build: Biome (`biome.json`) for unused code, type-only imports and undeclared dependencies, and oxlint with type information (`.oxlintrc.json`) for `return-await` (`in-try-catch`) and `require-await`. An exception goes on its line with the reason (`// biome-ignore lint/<group>/<rule>: <reason>`, `// oxlint-disable-next-line <rule> -- <reason>`).
- Formatting stays with Prettier (`npm run prettify`, in the pre-commit hook): upstream is formatted with it, so a picked commit applies without format conflicts.
