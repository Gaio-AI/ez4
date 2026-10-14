# EZ4: Local Agent

A local agent provider stub for EZ4 applications.

## Getting started

#### Install

```sh
npm install @ez4/local-agent -D
```

#### Emulation status

Local execution of Fargate agents during `ez4 serve` is not emulated in Phase 1. Invoking an agent client locally will reject with `AgentNotEmulatedError`. Deploy to an AWS staging environment with `ez4 deploy` to execute agent workflows. Full local container emulation is planned for Phase 2.

## License

MIT License
