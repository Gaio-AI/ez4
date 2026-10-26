---
'@ez4/project': minor
---

The CLI resolves the project's modules with synchronous hooks (`module.registerHooks`, preloaded with `--import`) instead of a `--loader` thread, and turns Node's compile cache on for the commands it runs (`ez4 serve`, `ez4 test`, `ez4 run`): the application process caches what it compiles in `NODE_COMPILE_CACHE`, or in Node's default directory under the system's temporary directory. A run with coverage (`--coverage`, or `NODE_V8_COVERAGE` set) leaves the cache off. The CLI now needs Node v22.15 or later, where `module.registerHooks` arrived.
