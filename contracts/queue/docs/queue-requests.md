# EZ4: Queue Requests

Queue requests define the **typed shape** of incoming messages processed by subscription handlers. The message type declared by the queue service is used to validate incoming requests before invoking handlers.

## Request declaration

The `Queue.Message` interface represents the full structure of an incoming message request, ensuring that handlers operate on strongly typed, validated, and [reflection‑driven](../../../foundation/reflection/) request data.

#### Using class (preferred)

```ts
declare class MyMessage implements Queue.Message {
  foo: string;
  bar: number;
}
```

> The request class is always an implementation of the base `Queue.Message` interface.

#### Using interface

```ts
interface MyRequest extends Queue.Message {
  foo: string;
  bar: number;
}
```

> The request interface is always an extension of the base `Queue.Message` interface.

#### Using type

```ts
type MyRequest = {
  foo: string;
  bar: number;
};
```

> Less verbose, but no clear indication that the type is a strong typed contract.

## Runtime request

Queue handlers receive a `Queue.Incoming<T>` request containing the validated message and retry metadata.

```ts
export async function processMessage(request: Queue.Incoming<MyMessage>) {
  request.message;
  request.attempt;
  request.maxAttempts;
  request.requestId;
  request.traceId;
}
```

- `message` is the validated queue payload.
- `attempt` is the current delivery attempt.
- `maxAttempts` is the maximum attempt count configured by the queue dead-letter settings.
- `requestId` identifies the request, and `traceId` can correlate work across services.

## Retrying messages

Handlers can request that the current message become available again by calling `retry` on the incoming request.

```ts
export async function processMessage(request: Queue.Incoming<MyMessage>) {
  if (shouldRetry(request.message)) {
    await request.retry();
    return;
  }
}
```

Pass a delay in seconds to override the queue's calculated backoff for that retry:

```ts
await request.retry({
  delay: 15
});
```

When no delay is supplied, the queue backoff configuration is used. Once the configured maximum attempts are exceeded, the message is sent to the dead-letter queue instead.

The retry method returns a promise and should be awaited. Handlers should return after requesting a retry and should avoid performing acknowledgement-dependent work afterward.

## Deferring messages

A wait that isn't a failure, such as a provider's rate limit or quota, shouldn't spend the attempts that lead to the dead-letter queue. `defer` sends a copy of the message back to the queue with the delay and consumes the current delivery, so the copy comes back as a new first attempt. A handler that defers declares its request as `Queue.DeferrableIncoming`:

```ts
export async function processMessage(request: Queue.DeferrableIncoming<MyMessage>) {
  const quota = await getQuota(request.message.accountId);

  if (quota.exhausted) {
    await request.defer({
      delay: quota.resetsIn
    });

    return;
  }
}
```

- A delay above 900 seconds (the longest a queue takes) is made of waits of 900 seconds; the copy comes back early and waits again without running the handler.
- A message is deferred at most 20 times, each wait counting once; past that, `defer` throws and the message fails like with any other error.
- A message of a FIFO queue can't be deferred, since its copy would lose its place in the group. A FIFO queue's handlers get `Queue.Incoming`, so a handler declaring `Queue.DeferrableIncoming` doesn't compile as its subscription (on an imported queue too, by the mode of the queue it imports), and the runtime throws if `defer` is reached there anyway.
- A message deferred by its handler is consumed even if the handler throws afterward, as its copy is already in the queue. `retry` after `defer` (or `defer` after `retry`) throws.

## Contract schema

Request validation and transformation are powered by the rich schema system provided by the [@ez4/schema](../../../foundation/schema/) package. Schemas define the structure, validation rules, and transformations applied before the request reaches your handler.

Learn more about schemas:

- [Object schema](../../../foundation/schema/docs/object-schema.md)
- [Array schema](../../../foundation/schema/docs/array-schema.md)
- [String schema](../../../foundation/schema/docs/string-schema.md)
- [Decimal schema](../../../foundation/schema/docs/decimal-schema.md)
- [Integer schema](../../../foundation/schema/docs/integer-schema.md)
- [Boolean schema](../../../foundation/schema/docs/boolean-schema.md)
- [Enum schema](../../../foundation/schema/docs/enum-schema.md)

## What's next

- [Queue service](./queue-service.md)
- [Queue subscriptions](./queue-subscriptions.md)
- [Queue handler](./queue-handler.md)
- [Queue listener](./queue-listener.md)
- [Queue client](./queue-client.md)

## License

MIT License
