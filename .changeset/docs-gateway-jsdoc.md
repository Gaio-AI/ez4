---
'@ez4/docs-gateway': minor
'@ez4/gateway': minor
'@ez4/schema': minor
'@ez4/aws-gateway': minor
'@ez4/aws-bucket': minor
---

The OpenAPI document is written from the JSDoc. An operation's `description` is its handler's JSDoc text and its `summary` the first sentence, unless `@description` or `@summary` say otherwise; request and response properties, parameters and models are described by their JSDoc; an optional request property tagged `@required` (such as an `If-Match` the handler refuses missing with its own error) is documented as required; the service's `@description` tag is `info.description` and its `@server <url> [description]` tags are `servers`. Descriptions and `@required` are documentation only: the deployed functions bundle the request and response schemas without them, so they bundle the same bytes as before.

A bucket deploy names UTF-8 in the content type of text files (`text/*`, JSON, JavaScript, XML, YAML, SVG, web manifests): a browser no longer guesses the encoding of a plain-text or Markdown file.
