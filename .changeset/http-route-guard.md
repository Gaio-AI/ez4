---
'@ez4/gateway': minor
'@ez4/aws-common': minor
'@ez4/aws-gateway': minor
'@ez4/local-gateway': minor
---

An HTTP service can declare a guard in its defaults, and each route what it allows:

```ts
defaults: Http.UseDefaults<{
  guard: typeof roleGuard;
}>;

routes: [
  Http.UseRoute<{
    path: 'GET /items';
    handler: typeof listItems;
    allow: [Role.Reader, Role.Writer];
  }>
];
```

- The guard runs in the route's function, after the request is validated and right before the handler, with the request, the route's `allow` and the context. Throwing refuses the request like a handler error. Authorizers never run it.
- `allow` is a literal (string, number, boolean, a tuple of them or an object of either); an enum member stands for its value.
- The build fails on a guarded route without `allow`, on `allow` without a guard, on routes outside a group that share a handler with different `allow`, and on an `allow` that isn't a literal.
- Only functions behind a guard change: a handler without one is bundled exactly as before. The function hash covers the guard and `allow`, and the guard's files join the source hash.
- `ez4 serve` and the HTTP tester run the guard at the same point.

`@ez4/aws-common`: a bundler handler takes an optional `guard` (`{ entrypoint, allow }`), and a guarded handler is cached and written apart from the same handler without it.
