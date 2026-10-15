# EZ4: Local Agent

A local agent provider stub for EZ4 applications.

## Getting started

#### Install

```sh
npm install @ez4/local-agent -D
```

#### Emulation status

Local execution of Fargate agents and agent workflows during `ez4 serve` is not emulated in Phase 1. Invoking an agent client or starting an agent workflow locally will reject with `AgentNotEmulatedError`. Deploy to an AWS staging environment with `ez4 deploy` to execute agents and workflows. Full local container emulation is planned for Phase 2.

## License

MIT License
