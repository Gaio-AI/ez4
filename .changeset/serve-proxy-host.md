---
'@ez4/project': patch
---

Add `serveOptions.proxy` so a served project gets the stable `<project>.<branch>.<domain>.localhost` host (port `80` unless `proxy.port` or `EZ4_PROXY_PORT` sets another), also used by the clients of its imports. Without `proxy` the host is unchanged.
