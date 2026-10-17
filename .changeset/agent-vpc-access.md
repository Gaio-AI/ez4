---
'@ez4/agent': minor
'@ez4/aws-agent': minor
---

An agent can declare `vpc: true` to reach the services that only the VPC reaches, as the `vpc` of a route does for a function. Its task runs in the security group tagged `ez4:agents-vpc=true` as well as the agents' own, and a deploy fails when no such group exists. The agents' group only leaves for the proxy, so that group is what carries the egress to the private services. A variable of the agent that holds a URL to a private IPv4 address is added to the task's `NO_PROXY`, so the request goes straight to the VPC instead of through the egress proxy, which only takes ports 80 and 443. Agents without `vpc` are unchanged.
