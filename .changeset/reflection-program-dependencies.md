---
'@ez4/reflection': minor
'@ez4/project': minor
---

`buildMetadata` resolves each function's dependency files over the program the reflection already built, instead of building a second TypeScript program that parses every file again. `getReflectionProgramFromFiles` returns the reflection with a `getReflectionFiles` bound to that program, and `buildReflectionProgram` is its project counterpart; `getReflectionFromFiles`, `buildReflection` and `getReflectionFiles` keep their signatures.

The dependency list is now complete. A file passed by a relative name (every service and handler file) resolved its imports from that name, so a package it imported directly (`@ez4/common`, a workspace package such as a shared library) was found only when another file of the same folder had resolved it first, through a module cache shared by the whole process. Imports now resolve from each file's absolute path, with a cache of their own per call. A file the program reads from another one (`reflection:loadFile`) keeps the imports of the file on disk.

The first deploy with this version changes the `sourceHash` of most functions once: they rebundle, and the ones whose bundle bytes are the same skip the upload. A function whose code changed in a package its handler imports directly, and was not redeployed for it, uploads now.
