---
'@ez4/aws-logs': patch
---

A removed log group is deleted once its logs have expired, and kept while it still holds events its retention hasn't reached. The guard was inverted: it deleted any group with a log stream and kept the empty ones forever, warning that they weren't empty. The stream count no longer decides it, since CloudWatch keeps a stream after all of its events expire: the newest stream's activity is compared with the group's retention instead, and a group without retention is kept. `--force` still deletes regardless.
