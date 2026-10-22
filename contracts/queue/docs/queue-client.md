# EZ4: Queue Client

The queue client exposes a simple, type-safe API for sending and receiving messages with the generated queue service. It is injected into the execution context when the queue service is available.

## Client API

The client API provides a unified, provider-agnostic way to access the queue service no matter which cloud provider is being used.

#### Send a message

```ts
export async function anotherHandler(_request: any, { myQueue }: Service.Context<MyService>) {
  await myQueue.sendMessage({
    foo: 'foo',
    bar: 123
  });
}
```

> The queue client validates the message against the declared queue message type before sending.

#### Send many messages

```ts
import { SendMessagesError } from '@ez4/queue/utils';

export async function anotherHandler(_request: any, { myQueue }: Service.Context<MyService>) {
  try {
    await myQueue.sendMessages([
      { foo: 'foo', bar: 1 },
      { foo: 'foo', bar: 2 }
    ]);
  } catch (error) {
    if (error instanceof SendMessagesError) {
      // Every other message was sent.
      for (const { index, message, error: reason } of error.failures) {
        console.error(index, message, reason.message);
      }
    }
  }
}
```

> The messages go in as few requests as the provider takes (on AWS, up to 10 messages and 1 MiB per request). Each message succeeds or fails on its own, as with `sendMessage`: the others are still sent, and then `SendMessagesError` lists each failed message with its position in the list and the reason. A fifo queue sends its requests one at a time, so each group keeps the order of the list, except a message SQS failed on its side, which is sent once more after the rest of its request.

#### Receive messages

```ts
export async function anotherHandler(_request: any, { myQueue }: Service.Context<MyService>) {
  const messages = await myQueue.receiveMessage({
    messages: 10,
    polling: 20
  });
}
```

> The `receiveMessage` call returns zero or more typed messages.

## What's next

- [Queue service](./queue-service.md)
- [Queue subscriptions](./queue-subscriptions.md)
- [Queue requests](./queue-requests.md)
- [Queue handler](./queue-handler.md)
- [Queue listener](./queue-listener.md)

## License

MIT License
