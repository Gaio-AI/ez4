---
'@ez4/project': patch
---

Add `ez4 proxy`: a local reverse proxy that routes `<name>.localhost` to the process registered for it. `ez4 proxy run <name> -- <command>` starts the proxy when needed, gives the command a free `PORT` on `127.0.0.1` and owns the route while it runs (`-d` runs it in background). `ez4 proxy ls` lists routes, `ez4 proxy stop <name>` stops one, and `ez4 proxy setup` allows port 80 without root on Linux.
