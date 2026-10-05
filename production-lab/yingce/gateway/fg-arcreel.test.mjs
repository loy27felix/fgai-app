import {test} from 'node:test';
import assert from 'node:assert/strict';
import {managedArcWrite} from './fg-arcreel.mjs';
import {creatorInternalRoute} from './fg-creator.mjs';
import {Readable} from 'node:stream';

test('an untrusted actor cannot use the private director catalog or costing endpoint',async()=>{
 for(const path of ['/internal/arcreel/00000000-0000-0000-0000-000000000001/models','/internal/arcreel/00000000-0000-0000-0000-000000000001/cost']){
  const req=Readable.from(['{}']);req.headers={authorization:'Bearer wrong'};req.method=path.endsWith('models')?'GET':'POST';
  let status,body;const res={writeHead(n){status=n;},end(v){body=JSON.parse(v);}};
  const handled=await creatorInternalRoute(req,res,{path:new URL(path,'http://test/'),pool:{query(){throw Error('authentication must precede all database access');}}});
  assert.equal(handled,true);assert.equal(status,403);assert.ok(body.error.message);
 }
});
test('managed credentials cannot be replaced; only selection of a configured director is allowed',()=>{
 for(const path of ['/api/v1/agent/credentials','/api/v1/agent/credentials/3','/api/v1/providers/openai/credentials','/api/v1/system/config','/api/v1/custom-endpoints'])assert.equal(managedArcWrite('PATCH',path),true);
 assert.equal(managedArcWrite('POST','/api/v1/agent/credentials/3/activate'),false);
 assert.equal(managedArcWrite('GET','/api/v1/system/config'),false);
 assert.equal(managedArcWrite('POST','/api/v1/projects'),false);
});
