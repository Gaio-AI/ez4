---
'@ez4/aws-gateway': patch
---

Add `throttling` (`rateLimit`, `burstLimit`) to `Http.Service`, applied to the API stage; removing it puts the account limits back on the stage, which needs `apigateway:GET` on `/account`.
