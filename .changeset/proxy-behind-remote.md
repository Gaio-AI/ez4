---
'@ez4/project': patch
---

`ez4 proxy` runs behind another server holding its port: it listens on the internal port (first of 1355–1359 holding an ez4 proxy, else the first free; EZ4_PROXY_INTERNAL_PORT moves the range start; also on the Docker bridge gateway), answers a health probe on `ez4-proxy-probe.localhost`, and keeps port-less URLs once that server routes `*.localhost` to it. `ez4 proxy run --remote VAR` routes a deployed API through a localhost host with localhost-only CORS. The Docker forwarder no longer mistakes another server on its internal port for the proxy.
