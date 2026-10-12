---
'@ez4/aws-gateway': patch
---

An `Http.Import` with `authorization` reads its key from a variable the linking service or the project already declares with that value, and adds `EZ4_HTTP_AUTHORIZATION_<SERVICE>` only when none does. That variable now holds the key alone; the client adds the `Bearer ` prefix. Every function of the linking service carries all of its variables and Lambda caps them at 4 KB: a service that declares the keys of the APIs it calls, and links ten of them, went past the cap with a second copy of each key.
