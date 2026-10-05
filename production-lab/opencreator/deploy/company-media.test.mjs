import {test} from 'node:test';
import assert from 'node:assert/strict';
import {companyMediaFetch} from './company-media.mjs';
import {execFileSync} from 'node:child_process';
test('download capability stays on the owned internal media GET route', async () => {
  const base = 'http://fg-gateway:3010/internal/creator/owned';
  const seen = [];
  const fetch = companyMediaFetch(async (url, init) => {seen.push({url, init});}, base, 'actor-fixture');
  await fetch(base + '/v1/media/result');
  assert.equal(seen[0].init.headers.get('authorization'), 'Bearer actor-fixture');
  assert.equal(seen[0].init.redirect, 'error');
  for (const url of ['http://thirdparty/result', base + '-other/v1/media/result', base + '/v1/images/generations',base+'/v1/media/../../../../other/v1/media/result']) {
    await fetch(url); assert.equal(seen.at(-1).init, undefined);
  }
});

test('daemon child installs scoped result authentication through its preload', () => {
  const actor='70f9ee5d-510d-4bfd-a46e-6eec2a23a2b8';
  const mock='data:text/javascript,'+encodeURIComponent('globalThis.fetch=async (url,init)=>({authorization:init?.headers?.get("authorization"),redirect:init?.redirect});');
  const script=`const result=await fetch('http://fg-gateway:3010/internal/creator/${actor}/v1/media/fixture');console.log(JSON.stringify(result));`;
  const result=execFileSync(process.execPath,['--import',mock,'--import',new URL('./company-media-preload.mjs',import.meta.url).href,'--input-type=module','-e',script],{env:{...process.env,FG_CREATOR_ACTOR:actor,FG_CREATOR_CAPABILITY:'actor-fixture'},encoding:'utf8'});
  assert.deepEqual(JSON.parse(result),{authorization:'Bearer actor-fixture',redirect:'error'});
});
