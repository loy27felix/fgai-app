import test from 'node:test';
import assert from 'node:assert/strict';
import { platformToken, requestPath, trustedOrigin, publicResourceRead, proxyHeaders, responseHeaders } from './policy.mjs';

const origin = 'https://192.168.0.99:3016';
test('anonymous delivery is confined to exact signed resource read routes',()=>{
  const id='12345678-1234-1234-1234-123456789abc';
  assert.equal(publicResourceRead('GET',new URL(`/api/public/resources/${id}/file?expires=1&signature=invalid`,origin)),true);
  assert.equal(publicResourceRead('HEAD',new URL(`/api/public/resources/${id}/file`,origin)),true);
  assert.equal(publicResourceRead('GET',new URL(`/api/public/resources/${id.replaceAll('-','')}/file`,origin)),true);
  for(const [method,path] of [['POST',`/api/public/resources/${id}/file`],['GET','/api/resources'],['GET','/api/public/resources/not-a-uuid/file'],['GET',`/api/public/resources/${id}/file/extra`],['GET','/api/admin/channels']]) {
    assert.equal(publicResourceRead(method,new URL(path,origin)),false);
  }
});
test('only one valid FG platform session is accepted', () => {
  const token = 'a'.repeat(64);
  assert.equal(platformToken(`theme=dark; fg_session=${token}`), token);
  for (const cookie of ['', 'fg_session=invalid', `fg_session=${token}; fg_session=${token}`, `other_fg_session=${token}`]) {
    assert.equal(platformToken(cookie), null);
  }
});
test('upstream authentication cannot be reached via encoded paths or an absolute foreign URL', () => {
  for (const path of ['/api/auth/login', '/api/auth/%6cogin', '/api/auth/password/reset', '/api/auth/email-verification']) {
    assert.equal(requestPath(path, origin).managedAuth, true);
  }
  for (const path of ['//evil.example/api', 'https://evil.example/', '/api/auth%2flogin', '/api/auth/%256cogin']) {
    assert.throws(() => requestPath(path, origin));
  }
  assert.equal(requestPath('/api/auth/session', origin).managedAuth, false);
  assert.equal(requestPath('/api/canvas-projects?q=abc', origin).url.search, '?q=abc');
});
test('writes require a configured exact origin, including port', () => {
  assert.equal(trustedOrigin('POST', origin, [origin]), true);
  for (const bad of [undefined, 'null', 'https://192.168.0.99', 'https://evil.example']) {
    assert.equal(trustedOrigin('POST', bad, [origin]), false);
  }
  assert.equal(trustedOrigin('GET', undefined, [origin]), true);
});
test('internal workspace blocks commerce but keeps model and usage APIs', () => {
  for (const path of ['/api/wallet', '/api/wallet/checkin', '/api/admin/payments/products', '/api/admin/%70ayments', '/api/admin/users/abc/credits/adjust', '/api/admin/redemption-codes']) {
    assert.equal(requestPath(path, origin).commercial, true);
  }
  for (const path of ['/api/admin/channels', '/api/admin/api-logs', '/api/tasks', '/api/admin/analytics', '/api/resources']) {
    assert.equal(requestPath(path, origin).commercial, false);
  }
});
test('browser credentials and forged bridge or forwarded headers never reach upstream', () => {
  const result = proxyHeaders({cookie:'fg_session=private', authorization:'Bearer private', connection:'x-private',
    'x-private':'private', 'x-canvas-upstream-headers':'private', 'x-yingce-agent-token':'private',
    'x-forwarded-host':'evil.example', forwarded:'host=evil.example', 'content-type':'application/json'},
    'open_ai_canvas_session=internal', '192.168.0.99:3016');
  assert.deepEqual(result, {'content-type':'application/json', cookie:'open_ai_canvas_session=internal',
    host:'192.168.0.99:3016', 'x-forwarded-proto':'https', 'x-forwarded-host':'192.168.0.99:3016'});
  assert.deepEqual(responseHeaders({'set-cookie':['upstream=private'], connection:'x-private', 'x-private':'secret',
    'content-type':'text/event-stream'}), {'content-type':'text/event-stream'});
});
