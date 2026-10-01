---
'@ez4/project': patch
'@ez4/local-gateway': patch
---

Under `ez4 serve` and `ez4 test`, an `Http.Import` finds the owner's API the way the deploy does: by the API's name when it has one, and by the referenced class otherwise. A deployed import looks the gateway up by the name API Gateway shows, so it may reference a narrower contract of an API, a class with the same `name` that the owner never serves. Locally the import called the owner by the referenced class and got `Service emulator not found.`. Now each local HTTP API is also served under its name (`ServiceEmulator.aliases`, which the serve router resolves), and an import of a named API calls it by that name.
