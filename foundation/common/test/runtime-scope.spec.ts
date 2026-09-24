import { deepEqual, equal, notEqual } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Runtime } from '@ez4/common';

describe('runtime scope', () => {
  const headers = {
    clientVersion: 'X-Client-Version',
    sessionId: 'x-session-id'
  };

  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: read lowercased headers from the first source that has them', () => {
    const values = Runtime.readScopeValues(
      headers,
      { 'x-client-version': '1.2.3', 'x-other': 'ignored' },
      { 'x-client-version': 'query-version', 'x-session-id': 'session-1' }
    );

    deepEqual(values, {
      clientVersion: '1.2.3',
      sessionId: 'session-1'
    });
  });

  it('assert :: omit missing keys', () => {
    deepEqual(Runtime.readScopeValues(headers, null, undefined, {}), {});
    deepEqual(Runtime.readScopeValues(undefined, { 'x-session-id': 'session-1' }), {});
    deepEqual(Runtime.readScopeValues(null, { 'x-session-id': 'session-1' }), {});
  });

  it('assert :: skip empty values', () => {
    const values = Runtime.readScopeValues(
      headers,
      { 'x-client-version': '', 'x-session-id': '' },
      { 'x-client-version': '1.2.3' }
    );

    deepEqual(values, { clientVersion: '1.2.3' });
  });

  it('assert :: truncate long values', () => {
    const values = Runtime.readScopeValues(headers, { 'x-session-id': 'a'.repeat(300) });

    equal(Runtime.MAX_SCOPE_VALUE_LENGTH, 256);
    equal(values.sessionId, 'a'.repeat(256));
  });

  it('assert :: set scope with extra keys and headers', () => {
    Runtime.setScope({ traceId: 'trace-1', clientVersion: '1.2.3' }, headers);

    deepEqual(Runtime.getScope(), { traceId: 'trace-1', clientVersion: '1.2.3' });
    deepEqual(Runtime.getScopeHeaders(), headers);
  });

  it('assert :: set scope without headers', () => {
    Runtime.setScope({ traceId: 'trace-2' });

    deepEqual(Runtime.getScope(), { traceId: 'trace-2' });
    deepEqual(Runtime.getScopeHeaders(), {});
  });

  it('assert :: export nothing without extra values', () => {
    Runtime.setScope({ traceId: 'trace-3' }, headers);

    equal(Runtime.exportScope(), undefined);

    Runtime.setScope({ traceId: 'trace-3', clientVersion: undefined }, headers);

    equal(Runtime.exportScope(), undefined);
  });

  it('assert :: export and import round trip', () => {
    Runtime.setScope({ traceId: 'trace-4', clientVersion: '1.2.3', sessionId: 'session-1' }, headers);

    const raw = Runtime.exportScope();

    deepEqual(JSON.parse(raw ?? ''), {
      values: { clientVersion: '1.2.3', sessionId: 'session-1' },
      headers
    });

    Runtime.setScope({ traceId: 'other' });
    Runtime.importScope('trace-5', raw);

    deepEqual(Runtime.getScope(), { traceId: 'trace-5', clientVersion: '1.2.3', sessionId: 'session-1' });
    deepEqual(Runtime.getScopeHeaders(), headers);
  });

  it('assert :: import keeps declared keys only and truncates them', () => {
    Runtime.importScope(
      'trace-6',
      JSON.stringify({
        values: { clientVersion: 'b'.repeat(300), undeclared: 'x', traceId: 'forged' },
        headers: { clientVersion: 'x-client-version', sessionId: 'x-session-id', invalid: 1 }
      })
    );

    deepEqual(Runtime.getScope(), { traceId: 'trace-6', clientVersion: 'b'.repeat(256) });
    deepEqual(Runtime.getScopeHeaders(), { clientVersion: 'x-client-version', sessionId: 'x-session-id' });
  });

  it('assert :: import tolerates missing or invalid payloads', () => {
    for (const raw of [undefined, '', 'not-json', 'null', '"text"', '[]', '{"values":1,"headers":"x"}']) {
      Runtime.setScope({ traceId: 'other', clientVersion: 'stale' }, headers);
      Runtime.importScope('trace-7', raw);

      deepEqual(Runtime.getScope(), { traceId: 'trace-7' });
      deepEqual(Runtime.getScopeHeaders(), {});
    }
  });

  it('assert :: read trace id from the first source that has a non-empty one', () => {
    equal(Runtime.readTraceId(undefined, { 'x-trace-id': '' }, { 'x-trace-id': 'trace-8' }), 'trace-8');
    equal(Runtime.readTraceId({ 'x-trace-id': 'header' }, { 'x-trace-id': 'query' }), 'header');
  });

  it('assert :: truncate long trace ids', () => {
    equal(Runtime.readTraceId({ 'x-trace-id': 'c'.repeat(300) }), 'c'.repeat(256));
  });

  it('assert :: generate a trace id when none is sent', () => {
    const traceId = Runtime.readTraceId(null, {});

    equal(typeof traceId, 'string');
    equal(traceId.length, 36);
    notEqual(traceId, Runtime.readTraceId());
  });

  it('assert :: build scope request headers from the current scope', () => {
    Runtime.setScope({ traceId: 'trace-9', clientVersion: '1.2.3', sessionId: undefined }, headers);

    deepEqual(Runtime.getScopeRequestHeaders(), {
      ['X-Trace-Id']: 'trace-9',
      ['X-Client-Version']: '1.2.3'
    });
  });

  it('assert :: build scope request headers without a scope', () => {
    equal(Runtime.getScope(), undefined);

    const requestHeaders = Runtime.getScopeRequestHeaders();

    deepEqual(Object.keys(requestHeaders), ['X-Trace-Id']);
    equal(requestHeaders['X-Trace-Id'].length, 36);
  });
});
