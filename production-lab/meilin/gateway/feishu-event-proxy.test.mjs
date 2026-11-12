import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {feishuEventRoute} from './feishu-event-proxy.mjs';

test('Feishu callback preserves signed bytes without forwarding login credentials',async(t)=>{
  const payload='{"type":"url_verification","challenge":"fixture","token":"fixture-token"}';
  let calls=0;
  const native=http.createServer(async(req,res)=>{
    calls++;const chunks=[];for await(const chunk of req)chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(),payload);
    assert.equal(req.url,'/api/integrations/feishu/events');
    assert.equal(req.headers['x-lark-signature'],'signed-fixture');
    assert.equal(req.headers.cookie,undefined);assert.equal(req.headers.authorization,undefined);
    res.writeHead(401,{'set-cookie':'not-forwarded=1'});res.end('{"code":401}');
  });
  await new Promise(resolve=>native.listen(0,'127.0.0.1',resolve));
  t.after(()=>{native.closeAllConnections();native.close();});
  const web='http://127.0.0.1:'+native.address().port;
  const gateway=http.createServer(async(req,res)=>{
    if(!await feishuEventRoute(req,res,{path:new URL(req.url,web),web})){res.writeHead(403);res.end();}
  });
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  t.after(()=>{gateway.closeAllConnections();gateway.close();});
  const origin='http://127.0.0.1:'+gateway.address().port;
  const response=await fetch(origin+'/api/integrations/feishu/events',{method:'POST',body:payload,headers:{cookie:'fg_session=private',authorization:'Bearer private','x-lark-signature':'signed-fixture'}});
  assert.equal(response.status,401);assert.equal(response.headers.get('set-cookie'),null);assert.deepEqual(await response.json(),{code:401});
  for(const [method,path] of [['GET','/api/integrations/feishu/events'],['POST','/api/admin/integrations/feishu'],['POST','/api/integrations/feishu/events/extra'],['POST','/api/integrations/feishu/events?token=x']])assert.equal((await fetch(origin+path,{method})).status,403);
  assert.equal((await fetch(origin+'/api/integrations/feishu/events',{method:'POST',body:'x'.repeat(1024*1024+1)})).status,413);
  assert.equal(calls,1);
});
