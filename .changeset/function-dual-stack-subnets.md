---
'@ez4/aws-function': minor
'@ez4/aws-vpc': minor
---

A function in a VPC is dual-stack when every one of its subnets has an IPv6 block: the deploy sets `Ipv6AllowedForDualStack`, so IPv6 destinations go through the subnets' IPv6 route (an egress-only internet gateway charges nothing per GB) while IPv4 ones keep going through the NAT. A subnet without IPv6 keeps the function on IPv4, and nothing changes for functions on IPv4-only subnets. `@ez4/aws-vpc` exports `areDualStackSubnets`.
