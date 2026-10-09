---
'@ez4/aws-aurora': minor
'@ez4/project': minor
---

Aurora clusters get IAM database authentication from the deploy, and a cluster update no longer rotates the master password:

- **IAM:** a cluster that some service links natively with a `user` (`Environment.Service<Db, { connectionMode: 'native', user: 'app' }>`) is created or updated with IAM database authentication on. The cluster stays available while it turns on, and existing connections and Data API calls go on. The deploy never turns it off, since an RDS Proxy or a person may sign in with it. A cluster nothing links that way keeps its parameters and gets no update.
- **Master password:** every cluster update (a scaling, deletion protection or HTTP endpoint change) used to rotate the master password. The Data API signs in with it, so its calls failed for minutes after each deploy that touched the cluster. The update now leaves the password alone; Secrets Manager's own rotation schedule is unchanged.

Supporting change:

- `@ez4/project`: the `deploy:prepareResources` event carries the project `metadata`.
