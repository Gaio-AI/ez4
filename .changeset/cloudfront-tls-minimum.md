---
'@ez4/aws-cloudfront': minor
---

A distribution with a custom certificate now refuses TLS 1.0 and 1.1: its security policy is `TLSv1.2_2021` (TLS 1.2 and 1.3 with ECDHE and AES-GCM or ChaCha20 ciphers) instead of `TLSv1`. A distribution on the default CloudFront certificate keeps `TLSv1`, the only policy CloudFront allows for it. CloudFront also reaches custom origins over TLS 1.2 at least, where it accepted SSLv3.

The policy is part of the distribution state, so the first deploy with this version plans `minimumProtocolVersion` on every distribution that has a certificate and updates each one once (CloudFront then takes a few minutes to deploy it). Viewers that only speak TLS 1.0 or 1.1 — browsers and systems older than about 2014 — stop connecting to those distributions.
