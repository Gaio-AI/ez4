# EZ4: Gateway Documentation Generator

A gateway documentation generator.

## Getting started

#### Install

```sh
npm install @ez4/docs-gateway -D
```

#### Generate

```sh
ez4 generate -- gateway:oas [ folder ]
```

It writes an OpenAPI 3.1 document for every HTTP service of the project, named after the service (`<service-name>-oas.yml`), in the given folder (the current one by default).

## Route documentation

The operation of each route takes its documentation from the JSDoc of the route handler:

| Tag                         | OpenAPI                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `@summary <text>`           | `summary`                                                   |
| `@description <text>`       | `description`                                               |
| `@deprecated`               | `deprecated: true`                                          |
| `@tag <name>`               | `tags`, one entry per tag, in their order                   |
| `@throws <status> [<text>]` | An error response (see [Error responses](#error-responses)) |

```ts
/**
 * @summary Create an item.
 * @description Create an item in the store.
 * @tag Items
 * @tag Writes
 * @throws 409 An item with the same name exists.
 */
export function createItemHandler(request: CreateItemRequest): CreateItemResponse {
  // ...
}
```

The route `name` is the `operationId`, and the handler name when the route has no name.

## Schemas

Request and response bodies are in `components.schemas`:

- Response body: named after the route handler (`createItemHandler`).
- Request body: named after the route handler with the `Request` suffix (`createItemHandlerRequest`).

A property is required unless it's optional (`?:`). A nullable property (`| null`) is still required, and its schema takes `null` too (`type: [string, 'null']`, `null` in an `enum`, or an `anyOf` option for a reference or a union).

Headers, path parameters and query strings are strings that are never null, so they're documented by their type alone: a request one is required unless it's optional, and a response header is required unless it's optional or nullable.

## Response headers

The headers the handler response declares are the `headers` of each of its success statuses.

## Error responses

Each operation lists the errors the route can respond, besides its success statuses:

| Status       | When                                                                                   | Body           |
| ------------ | -------------------------------------------------------------------------------------- | -------------- |
| 400          | The route request declares headers, path parameters, query strings, body or identity.  | `HttpError`    |
| `httpErrors` | Every status of the service `defaults.httpErrors` and of the route `httpErrors`.       | `HttpError`    |
| `@throws`    | Every status of a `@throws <status>` in the handler JSDoc.                             | `HttpError`    |
| 401, 403     | The route has an authorizer, the gateway answers when it denies the request by itself. | `GatewayError` |

- `HttpError` is the body of the errors the service returns: `{ type: 'error', message, context? }`.
- `GatewayError` is the body of the errors the gateway returns by itself: `{ message }`.

A route error takes the place of the service error with the same name. A status with both bodies documents both (`anyOf`).

`@throws` documents an `HttpError` the handler raises (such as `HttpNotFoundError`), and changes nothing at runtime. Its text is the description of the response, one paragraph per `@throws` of the same status, and the status name when no `@throws` of it has a text. A `@throws` that doesn't start with an error status (`4xx` or `5xx`), such as `@throws {ItemNotFoundError}`, documents the function only.

```ts
/**
 * @throws 404 The item doesn't exist.
 * @throws 429 Rate limit exceeded.
 */
export function readItemHandler(request: ReadItemRequest): ReadItemResponse {
  // ...
}
```

## Security schemes

Each authorizer key, from its request headers and query strings, is a security scheme:

- The `authorization` header is an HTTP `bearer` scheme.
- Any other header or query string is an `apiKey` scheme.

An authorizer with a single key gives its name to the scheme. With more keys, each one is a scheme of its own (`<authorizer>.<header|query>.<key>`), and the operation requires all of them.

## License

MIT License
