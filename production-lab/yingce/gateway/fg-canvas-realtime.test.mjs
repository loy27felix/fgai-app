import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import WebSocket,{WebSocketServer} from 'ws';
import {registerCanvasRealtime} from './fg-canvas-realtime.mjs';

test('canvas websocket authenticates, replaces cookies, and forwards messages in both directions',async()=>{
 const native=http.createServer(), wss=new WebSocketServer({server:native});
 native.listen(0,'127.0.0.1');await once(native,'listening');
 wss.on('connection',(socket,req)=>{assert.equal(req.headers.cookie,'native-session');assert.equal(req.headers.origin,'https://fg.test');socket.send(JSON.stringify({type:'welcome'}));socket.on('message',data=>socket.send(data.toString()));});
 const gateway=http.createServer();
 registerCanvasRealtime(gateway,{authenticate:async req=>req.headers.cookie==='platform-session'?{id:'member'}:null,session:async()=> 'native-session',origins:['https://fg.test'],parsePath:url=>({url:new URL(url,'http://test')}),web:`http://127.0.0.1:${native.address().port}`,publicOrigin:'https://fg.test'});
 gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
 const url=`ws://127.0.0.1:${gateway.address().port}/api/canvas-projects/document/realtime`;
 const client=new WebSocket(url,{headers:{cookie:'platform-session',origin:'https://fg.test'}});
 try {
  const received=[];client.on('message',data=>received.push(JSON.parse(data.toString())));
  await once(client,'open');client.send(JSON.stringify({type:'presence',cursor:{x:10,y:20}}));
  for(let i=0;i<50&&received.length<2;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(received,[{type:'welcome'},{type:'presence',cursor:{x:10,y:20}}]);
  const rejected=new WebSocket(url,{headers:{origin:'https://fg.test'}});
  const status=await new Promise(resolve=>{rejected.on('unexpected-response',(_req,res)=>{resolve(res.statusCode);res.resume();rejected.terminate();});rejected.on('error',()=>{});});
  assert.equal(status,401);
 } finally {client.terminate();for(const socket of wss.clients)socket.terminate();await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>native.close(r))]);}
});
