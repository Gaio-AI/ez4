---
'@ez4/aws-bucket': patch
---

`Bucket.Service` can keep objects removed from `localPath` as stale for `staleExpireDays` before S3 expires them, and set `Cache-Control` per path with `cacheControl`. Both are opt-in.
