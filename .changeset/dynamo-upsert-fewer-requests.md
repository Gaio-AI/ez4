---
'@ez4/aws-dynamodb': patch
---

`upsertOne` no longer reads the item before writing it:

- **Nothing to update and nothing to select** (a claim): it inserts, and a duplicate answers `inserted: false`. One request whether the item exists or not, and an existing item is no longer written.
- **Otherwise:** it updates first, which an existing item takes in one request. A missing item is inserted next, and one that another writer inserted in between is updated again.

The item each case leaves and the result are the same as before. The expected refusals along the way (the update of a missing item, the insert of an existing one) are no longer logged as query errors. `executeStatement` takes the errors a caller expects, so it does not log them.
