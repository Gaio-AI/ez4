---
'@ez4/local-storage': patch
---

The local bucket keeps the object attributes S3 keeps. `write` stores the content type (the given one, or the one from the key's extension, as the AWS client does), metadata, cache control and expiry, and `stat` returns them instead of guessing the type from the bytes. An object stored without a content type reports `binary/octet-stream`, as S3 does. `scan` takes a string prefix and returns full keys, objects only and in order. `delete` of a missing key succeeds, `read` and `copy` of a missing key throw `NoSuchKey`, and `copy` creates the target's folders, carries the attributes and fires the create event. Uploads through signed URLs keep their content type, metadata and headers, and their key no longer starts with `/`, so event prefixes match them. A failing event handler is retried twice and never crashes the process. The client mock follows the same rules.
