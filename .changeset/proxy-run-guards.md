---
'@ez4/project': patch
---

`ez4 proxy` fails with a clear message when port 80 needs root outside Linux instead of starting a Docker forwarder that cannot reach host loopback. `ez4 proxy run` refuses a route held by a running process, requires a command, and no longer sends Ctrl+C to its command twice.
