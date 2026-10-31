---
'@ez4/database': minor
'@ez4/pgclient': minor
'@ez4/pgmigration': minor
'@ez4/aws-aurora': minor
'@ez4/raw-pg': minor
---

A Postgres table declares `timestamps: { created: 'created_at'; updated: 'updated_at' }` (each key optional) for the
database to write them: both columns default to the statement time truncated to the millisecond, and a `BEFORE UPDATE`
trigger (`ez4_stamp_<column>`, running a function shared by the tables with that column) writes the update timestamp on
every update, overriding whatever the update gives. Each column is a required date-time that isn't the primary key.

The ORM follows: an insert (`insertOne`, `insertMany`, the insert of `upsertOne` and of related records) may leave the
timestamps out, an update can't write them, and `updateOne`/`updateMany` take `touch: true` on a table with an update
timestamp to write the records even when `data` changes nothing.

The migration adds the defaults, the function and the trigger before the new code (`prepare`), and drops them after the
old code is gone (`cleanup`) when a table stops declaring the option. Renaming a timestamp column needs a deploy without
the option on it. The deploy plan warns about the locks on a table gaining the option, and about indexes on the update
timestamp, which make every update of the table a non-HOT one. A table that doesn't declare the option migrates and
hashes as before. The engines that support it declare `timestampsMode` (Aurora, raw-pg and the pgclient engine).
