import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getContentType } from '../src/object/client';

describe('bucket object content type', () => {
  it('names UTF-8 for text files', () => {
    equal(getContentType('developers/llms.txt'), 'text/plain; charset=utf-8');
    equal(getContentType('developers/index.md'), 'text/markdown; charset=utf-8');
    equal(getContentType('index.html'), 'text/html; charset=utf-8');
    equal(getContentType('assets/app.css'), 'text/css; charset=utf-8');
  });

  it('names UTF-8 for text formats typed as application', () => {
    equal(getContentType('assets/app.js'), 'application/javascript; charset=utf-8');
    equal(getContentType('developers/workflow-graph-schema.json'), 'application/json; charset=utf-8');
    equal(getContentType('sitemap.xml'), 'application/xml; charset=utf-8');
    equal(getContentType('site.webmanifest'), 'application/manifest+json; charset=utf-8');
    equal(getContentType('logo.svg'), 'image/svg+xml; charset=utf-8');
  });

  it('names UTF-8 for YAML whichever type it is given', () => {
    const contentType = getContentType('developers/openapi.yml');

    equal(contentType?.endsWith('; charset=utf-8'), true, contentType ?? 'no type');
  });

  it('leaves binary files as they are', () => {
    equal(getContentType('cover.png'), 'image/png');
    equal(getContentType('font.woff2'), 'font/woff2');
    equal(getContentType('download.pdf'), 'application/pdf');
  });
});
