---
'@ez4/project': patch
---

Harden `ez4 proxy`: it listens on loopback only, rejects hosts that are not plain hostnames, survives upstream and client disconnects, restarts its daemon behind the port 80 forwarder, and reports port 80 conflicts. `ez4 proxy run -d` reports proxy start errors and its `stop` ends the whole command chain.
