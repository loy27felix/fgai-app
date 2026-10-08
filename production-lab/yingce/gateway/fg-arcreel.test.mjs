import {test} from 'node:test';
import assert from 'node:assert/strict';
import {managedArcWrite,waitingPage,publicArcResponseHeaders} from './fg-arcreel.mjs';
import {creatorInternalRoute} from './fg-creator.mjs';
import {Readable} from 'node:stream';

test('director slash redirects stay on the public gateway instead of exposing the private runtime',()=>{
 const target=new URL('http://10.209.151.242:1241/app');
 assert.equal(publicArcResponseHeaders({location:'http://10.209.151.242:1241/app/?tab=projects'},target).location,'/app/?tab=projects');
 assert.equal(publicArcResponseHeaders({location:'/app/projects'},target).location,'/app/projects');
 assert.equal(publicArcResponseHeaders({location:'https://example.test/help'},target).location,'https://example.test/help');
});

test('unavailable document requests render a retryable HTML page while APIs retain JSON errors',()=>{
 let status,headers,body;
 const res={writeHead(code,value){status=code;headers=value;},end(value){body=value;}};
 assert.equal(waitingPage({method:'GET',url:'/app/projects'},res),true);
 assert.equal(status,503);assert.match(headers['content-type'],/text\/html/);
 assert.match(body,/http-equiv="refresh" content="5"/);assert.match(body,/正在准备你的导演工作台/);
 assert.equal(waitingPage({method:'GET',url:'/api/v1/projects'},res),false);
 assert.equal(waitingPage({method:'POST',url:'/app/projects'},res),false);
});

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
