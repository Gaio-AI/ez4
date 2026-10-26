---
'@ez4/aws-cloudfront': patch
---

Destroying a distribution that has aliases now works. CloudFront only deletes a disabled distribution, and the
update that disabled it was sent without the distribution's certificate or rewrite function. CloudFront refuses aliases
on its default certificate, so the destroy failed before reaching the delete, and a rewrite behavior went without its
function.
