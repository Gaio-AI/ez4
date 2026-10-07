---
'@ez4/aws-aurora': minor
'@ez4/pgclient': minor
'@ez4/project': minor
---

Native Aurora connections (`connectionMode: 'native'`) are ready for production:

- **IAM:** a `user` link option signs in with IAM (a token per connection, no secret). The execution policy grants `rds-db:connect` on the clusters the project links natively and on their proxies, by resource id.
- **Proxy:** a link goes through the RDS Proxy named after the cluster when one is available, otherwise to the writer. The proxy endpoint reaches the function as a variable (`EZ4_AURORA_PROXY_<CLUSTER>`), so creating or removing the proxy shows in the plan and switches the functions on the next deploy.
- **TLS:** always on, trusting the public roots and the inlined RDS certificate bundle. Before, the pool had TLS off and was refused by clusters with `rds.force_ssl`.
- **Pool:** one connection per function instance, closed after 5 minutes idle.
- **Retries:** opening a connection is retried while the database restarts or resumes. A statement whose session the server ended runs again on a new connection, outside transactions.

Supporting changes:

- `@ez4/pgclient`: `password` may be a function called for each new connection; new `idleTimeout` connection option.
- `@ez4/project`: the `deploy:prepareExecutionPolicy` event carries the project `metadata`.
- Projects that link a database natively need `rds:DescribeDBProxies` to deploy (see the `@ez4/aws-aurora` README). Projects on the Data API make no new call.
