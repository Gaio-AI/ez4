---
'@ez4/aws-agent': patch
---

The agent runtime turns the egress proxy on for its own `fetch` calls. Node reads `NODE_USE_ENV_PROXY` only when it starts, so the proxy variables the runtime sets afterwards reached the provider CLI it spawns but not the requests of the runtime itself, which went out directly and failed with `fetch failed` behind the isolated security group. It now calls `http.setGlobalProxyFromEnv()` once they are set, where Node has it (24.14 and later).
