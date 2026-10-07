---
'@ez4/aws-function': minor
'@ez4/aws-vpc': minor
---

Functions that need a VPC run in the subnets and security groups of the default VPC tagged `ez4:functions` = `true` (in a stable order), or, when none is tagged, in its first two subnets and its default security group as before. The configuration in use is kept in the function state: a deploy after the network changes shows the move in the plan and reconfigures the function, where before the subnets were looked up again on each configuration update and the plan never showed them. The first deploy with this version reports the configuration once for every function already in a VPC. New exports: `FunctionVpcTag`, `resolveFunctionVpcConfig` and `getFunctionVpcConfig` (`@ez4/aws-function`), `getTaggedSubnetIds`, `getTaggedSecurityGroupIds` and `VpcTag` (`@ez4/aws-vpc`).
