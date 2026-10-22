# EZ4: Queue Subscriptions

Subscriptions represent how a queue consumes messages. Each subscription is fully typed, [reflection‑driven](../../../foundation/reflection/), and declarative. EZ4 uses the subscription declaration to generate the necessary infrastructure, permissions, handler binding plus optional lifecycle listeners, batching, concurrency, and more.

## Subscription declaration

Declare subscriptions using the `Queue.UseSubscription` helper on the service.

```ts
subscriptions: [
  Queue.UseSubscription<{
    listener: typeof queueListener;
    handler: typeof processMessage;
    concurrency: 4;
    timeout: 120;
    batch: 5;
  }>
];
```

## Subscription fields

The following fields define the behavior, infrastructure, and runtime configuration of a queue subscription.

#### Handler

Main entry‑point function for the processing queue messages.

- Invoked per message in the batch.
- Runs in its own cloud resource.

```ts
handler: typeof processMessage;
```

> Use `typeof` because the message handler is referenced by type. See the queue [handler](./queue-handler.md) for more details.

#### Listener (optional)

Lifecycle listener for the subscription.

- Runs inside the same cloud resource as the subscription handler.
- Receives events such as request begin, request end, and internal transitions.
- Useful for logging, tracing, metrics, and instrumentation.

```ts
listener: typeof queueListener;
```

> Use `typeof` because the subscription listener is referenced by type. See the queue [listener](./queue-listener.md) for more details.

#### Variables (optional)

Declares environment variables associated with the handler.

- Supports both mapped variables and literal values.
- During metadata build, `Environment.Variable<'NAME'>` must resolve to a non-empty value.
- Use `Environment.VariableOrValue<'NAME', Default>` to fallback to `Default` when the environment variable is missing.
- Variables here are only accessible through `process.env`.

```ts
variables: {
  VARIABLE_A: Environment.Variable<'ENV_VAR_NAME'>;
  VARIABLE_B: 'literal value';
}
```

#### Concurrency (optional)

Maximum number of concurrent executions handlers.

```ts
concurrency: 10;
```

#### Batch (optional)

Maximum number of messages per handler invocation.

- A FIFO queue takes at most `10` messages per batch.

```ts
batch: 5;
```

#### Parallelism (optional)

Maximum number of messages one handler invocation processes at the same time. The default, `1`, processes them one after another. Messages from the same group in a FIFO queue still run in order. A message starts only while the invocation has time left for the slowest message so far; the ones it doesn't start go back to the queue.

- It overlaps only the waits of work that doesn't share a connection.
- When every message goes through the same single connection (a database client with a pool of one, for instance), the messages wait for each other on it, and a parallelism above `1` changes nothing.

```ts
parallelism: 5;
```

#### Acknowledge (optional)

How a handler invocation acknowledges the messages of its batch.

- `record` (default): each message of a batch is deleted from the queue as soon as it's handled, so an invocation that dies on a later message doesn't run the earlier ones again.
- `batch`: no message is deleted on its own. Once the invocation returns, the queue deletes the whole batch together, except the messages that failed or were handed back, which saves a delete request per message.
- With `batch`, an invocation that dies (timeout, crash) or fails after some messages ran gets the whole batch back: those messages run again, each one spending another attempt toward the dead-letter queue. Use it only with idempotent handlers.

```ts
acknowledge: 'batch';
```

#### Idempotency (optional)

Runs the handler once per key while the key is kept, however many times the queue delivers the message. The key is the value of one or more required message fields that name the unit of work (the id of the provider event, or the job and the contact it's for), never a timestamp.

- A message whose key already ran is acknowledged without running the handler.
- A message whose key is running in another execution goes back to the queue.
- A handler that fails, or calls `retry`, frees the key for the next attempt.
- A handler that throws `UnknownOutcomeError` (from `@ez4/queue/utils`), because its work may or may not have happened, keeps the key and the message is consumed: it runs neither again nor twice.
- `ttl` is how long (in seconds) a key that ran keeps a repeated message out. A running key is held for the queue timeout, so an execution that dies frees it once its message is visible again.
- It also makes the `batch` acknowledge safe: what already ran is skipped when the batch comes back.

```ts
idempotency: {
  key: ['jobId', 'contactId'];
  ttl: 604800;
};
```

On AWS the keys are kept in a DynamoDB table per queue (`<queue name>-claims`, with time to live), created with the first subscription that declares idempotency and removed with the last one. Each message costs two writes.

#### Key concurrency (optional)

Runs at most `max` messages with the same key at once, across every execution of the subscription: a message whose key has no free slot is deferred for 5 to 30 seconds instead of running, without spending an attempt (and without counting toward the most a message is deferred). For a limit per tenant, such as one account's share of a provider quota. The key is the value of one or more required message fields.

```ts
keyConcurrency: {
  key: 'accountId';
  max: 1;
};
```

- A slot is held for the queue timeout at most, so an execution that dies frees it on its own.
- Not available on a FIFO queue, where a waiting copy would lose its place in the group; the group already runs one message at a time.
- On AWS the slots live in the same `<queue name>-claims` table as the idempotency keys, at two writes per message when a slot is free.

#### Log retention (optional)

Specifies the number of days logs should be retained.

- Applies to the handler's log group.

```ts
logRetention: 90;
```

#### Log level (optional)

Sets the log level for the handler.

- Controls the verbosity of logs emitted by the runtime.

```ts
logLevel: LogLevel.Debug;
```

#### Architecture (optional)

Defines the CPU architecture for the handler.

- ARM architectures may reduce cost and improve performance.
- x86 architectures may be better for heavy workloads.

```ts
architecture: ArchitectureType.Arm;
```

#### Runtime (optional)

Specifies the runtime environment for the handler.

- Determines the Node.js runtime version used.
- Must match supported cloud provider runtimes.

```ts
runtime: RuntimeType.Node24;
```

#### Memory (optional)

Amount of memory available to the handler (in MB).

- Higher memory increases CPU allocation proportionally.
- Useful for compute‑heavy or parallel workloads.

```ts
memory: 128;
```

#### Files (optional)

Additional files to include in the handler bundle.

- Useful for static assets, configuration files, or templates.
- Paths are relative to the project root.

```ts
files: ['settings.json'];
```

#### Debug (optional)

Enables debug mode for the handler.

- May enable additional logging or diagnostics.
- Behavior depends on the cloud provider and runtime.

```ts
debug: true;
```

#### VPC (optional)

Enables VPC access for the subscription handler.

- Allows the handler to access private resources inside the default VPC.
- May increase cold‑start latency.

```ts
vpc: true;
```

## What's next

- [Queue service](./queue-service.md)
- [Queue requests](./queue-requests.md)
- [Queue handlers](./queue-handler.md)
- [Queue listeners](./queue-listener.md)
- [Queue client](./queue-client.md)

## License

MIT License
