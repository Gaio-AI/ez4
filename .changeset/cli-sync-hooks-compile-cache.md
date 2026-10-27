---
'@ez4/project': minor
---

The CLI resolves the project's modules with synchronous hooks (`module.registerHooks`, preloaded with `--import`) instead of a `--loader` thread, and turns Node's compile cache on for every command except `ez4 serve`: the application process caches what it compiles in `node_modules/.cache/ez4` under the working directory. `ez4 serve` runs without the cache, even when `NODE_COMPILE_CACHE` asks for one, since each reload loads the whole graph under a new module URL and would keep adding entries; a run with coverage (`--coverage`, or `NODE_V8_COVERAGE` set) runs without it too. The CLI now needs Node v22.15 or later, where `module.registerHooks` arrived.
