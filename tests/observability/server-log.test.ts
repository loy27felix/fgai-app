import assert from 'node:assert/strict';
import test from 'node:test';
import { redactServerLogText, requestTraceId } from '../../lib/observability/server-log';

test('server logs redact provider credentials, signed query values, and data URLs', () => {
  const value = redactServerLogText(
    'Bearer sk-abcdefghijklmnopqrstuvwxyz token=abc123 signature=long-value data:image/png;base64,abcdefghijklmnopqrstuvwxyz1234567890',
  );
  assert.doesNotMatch(value, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(value, /abc123/);
  assert.match(value, /\[redacted\]/);
});

test('requestTraceId accepts a safe correlation header and replaces unsafe input', () => {
  const supplied = requestTraceId(new Request('http://localhost/api/test', { headers: { 'x-fg-trace-id': 'creator-image:task-1234' } }));
  assert.equal(supplied, 'creator-image:task-1234');

  const generated = requestTraceId(new Request('http://localhost/api/test', { headers: { 'x-fg-trace-id': 'bad value with spaces' } }));
  assert.match(generated, /^[0-9a-f-]{36}$/i);
});
