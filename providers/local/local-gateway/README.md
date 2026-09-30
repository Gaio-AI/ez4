# EZ4: Local Gateway

A local gateway emulator.

## Getting started

#### Install

```sh
npm install @ez4/local-gateway -D
```

#### Local options

A WebSocket connection closes after 10 minutes without a message from the client and 2 hours after it opens, as in API Gateway. Both limits (in seconds) can change per service, under its name in snake case; under `ez4 test`, `testOptions` wins over `localOptions`:

```js
localOptions: {
  chat_ws: {
    idleTimeout: 60,
    connectionDuration: 600
  }
}
```

## License

MIT License
