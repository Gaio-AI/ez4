# EZ4: Gateway Guard

A gateway guard decides whether a request may reach the route handler. Each route declares in `allow` what it allows, and the guard, declared once in the service defaults, receives that value with the request. The check then lives in the route declaration, next to its path and authorizer, instead of in the first line of every handler.

## Declaration

```ts
export declare class MyServer extends Http.Service {
  defaults: Http.UseDefaults<{
    guard: typeof roleGuard;
  }>;

  routes: [
    Http.UseRoute<{
      path: 'GET /items';
      authorizer: typeof userAuthorizer;
      handler: typeof listItems;
      allow: [Role.Reader, Role.Writer];
    }>,
    Http.UseRoute<{
      path: 'POST /items';
      authorizer: typeof userAuthorizer;
      handler: typeof createItem;
      allow: Role.Writer;
    }>
  ];
}
```

`allow` is a literal value: a string, number or boolean, a tuple of them, or an object of either. An enum member stands for its value, so `[Role.Reader, Role.Writer]` reaches the guard as `['reader', 'writer']`. What the value means is up to the guard.

## Guard implementation

A guard receives the incoming request, the route's `allow` and the service context. Throwing refuses the request the same way an error thrown by the handler does, so an `HttpForbiddenError` answers 403 with its message.

```ts
export function roleGuard(request: Http.Incoming<{ identity: UserIdentity }>, allow: Role | Role[]) {
  const roles = Array.isArray(allow) ? allow : [allow];

  if (!roles.includes(request.identity.role)) {
    throw new HttpForbiddenError(`Missing role: ${roles.join(' or ')}`);
  }
}
```

## When it runs

- Inside the route's function, after the request is validated (identity, headers, parameters, query and body) and right before the handler. Listeners see the refusal as any handler error.
- Never in authorizers, which are shared between routes and cached by their identity source: a decision taken there for one route would answer the next route of the same token.
- In a route group, each route runs behind its own `allow`.
- Locally, `ez4 serve` and the HTTP tester run the guard at the same point.

## Build checks

- With a guard in the defaults, every route must declare `allow`. A route without one fails the build instead of going unguarded.
- A route declaring `allow` in a service without a guard fails the build, since nothing would enforce it.
- Routes outside a group that share a handler share its function, so they must declare the same `allow`.
- `allow` must be a literal: `allow: string` fails the build.

## Deploy

Only functions behind a guard change: a handler without one is bundled exactly as before. The function hash covers the guard and the route's `allow`, so changing only what a route allows updates its function.

## What's next

- [HTTP routes](./http-routes.md)
- [Gateway handlers](./gateway-handler.md)
- [Gateway authorizers](./gateway-authorizer.md)
- [Gateway listeners](./gateway-listener.md)
- [Gateway defaults](./gateway-defaults.md)

## License

MIT License
