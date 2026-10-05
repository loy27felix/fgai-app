import {test} from 'node:test';
import assert from 'node:assert/strict';
import {companyMediaFetch} from './company-media.mjs';
test('download capability stays on the owned internal media GET route', async () => {
  const base = 'http://fg-gateway:3010/internal/creator/owned';
  const seen = [];
  const fetch = companyMediaFetch(async (url, init) => {seen.push({url, init});}, base, 'actor-fixture');
  await fetch(base + '/v1/media/result');
  assert.equal(seen[0].init.headers.get('authorization'), 'Bearer actor-fixture');
  assert.equal(seen[0].init.redirect, 'error');
  for (const url of ['http://thirdparty/result', base + '-other/v1/media/result', base + '/v1/images/generations']) {
    await fetch(url); assert.equal(seen.at(-1).init, undefined);
  }
});
