---
'@ez4/local-distribution': patch
---

New local emulator for `Cdn.Service`. With `@ez4/local-distribution` installed, `ez4 serve` and `ez4 test` no longer stop with `No emulator provider for contract` on a project that declares a CDN: the distribution is served under `http://<serve host>/<identifier>/` with the routing, default index, rewrite rules, bucket and regular origins, fallbacks and disabled state its CloudFront deploy has. An origin whose `cache.headers` names `cloudfront-viewer-country` receives it from `localOptions.<distribution_name>.viewerCountry`, `US` by default.
