---
"@ez4/aws-aurora": minor
"@ez4/project": patch
---

Run Aurora migrations and integrity checks over a direct connection to the writer with `EZ4_AURORA_CONNECTION=direct`, from inside the cluster's VPC or through a tunnel named in `EZ4_AURORA_TUNNELS`, instead of the Data API and its 45-second cut. Deadlocks and lock timeouts of a direct connection are recognized like the Data API's. `ez4 serve` and `ez4 test` load a `.pem` import as its text, as the package bundlers do.
