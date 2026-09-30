# EZ4: Local Distribution

A local distribution (CDN) emulator.

## Getting started

#### Install

```sh
npm install @ez4/local-distribution -D
```

## Local behavior

Every `Cdn.Service` is served at `http://<serve host>/<identifier>/<path>` the way its CloudFront deploy (`@ez4/aws-cloudfront`) answers:

- The request goes to the first origin whose `path` pattern matches (case-sensitive, `*` for any characters, `?` for exactly one), otherwise to `defaultOrigin`.
- `defaultIndex` is served for the root path only.
- Rewrite rules run as the deployed viewer function does, including `301` and `302` redirects.
- Bucket origins are read through the local storage emulator: a missing object answers `404` and methods other than `GET` and `HEAD` answer `403`.
- Regular origins receive the viewer headers (except `host`), the origin `headers`, `x-forwarded-for` and, when named in the origin `cache.headers`, `cloudfront-viewer-country`. A domain on this machine (`localhost`, `127.0.0.1` or the serve host) is reached over plain HTTP.
- Fallbacks answer the `location` page with status `200`.
- A disabled distribution answers `403`.

Certificates, aliases and caching don't apply locally: every request reaches the origin.

#### Local options

Set in the project options, under the snake-case name of the distribution (`SiteCdn` below):

```js
export default {
  localOptions: {
    site_cdn: {
      // Country code sent as `cloudfront-viewer-country` (default: `US`).
      viewerCountry: 'BR'
    }
  }
};
```

## License

MIT License
