---
'@ez4/project': minor
'@ez4/aws-common': minor
---

`deploy`, `destroy` and `output` swap the AWS credentials of the environment for an MFA session when `AWS_MFA_SERIAL` is set (in the shell or the `-e` file) and no session token is in place. The code is asked in the terminal, `sts:GetSessionToken` opens a session of 12 hours, and it is kept in `~/.ez4/mfa` for the access key that opened it, so the next command asks nothing until it expires. Anything signed with the session carries `aws:MultiFactorAuthPresent`, which a `docker push` to ECR needs where an IAM policy denies requests without it. Providers receive the new `session:prepare` event right after the environment is loaded.
