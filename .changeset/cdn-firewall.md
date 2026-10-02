---
'@ez4/aws-cloudfront': patch
---

Add `firewall` to `Cdn.Service`, the ARN of an AWS WAF web ACL (CloudFront scope) to associate with the distribution; without it, the distribution has no web ACL, so one associated outside the code is removed on the next update.
