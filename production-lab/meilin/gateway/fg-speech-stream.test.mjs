import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {EventEmitter,once} from 'node:events';import {gzipSync} from 'node:zlib';
import WebSocket from 'ws';import {bridge,registerSpeechStream} from './fg-speech-stream.mjs';
class Client extends EventEmitter{readyState=1;messages=[];send(v){this.messages.push(JSON.parse(v));}close(){this.readyState=3;this.emit('close');}}
function response(text,last=false){const b=gzipSync(Buffer.from(JSON.stringify({result:{text,utterances:[]}}))),h=Buffer.alloc(12);h[0]=0x11;h[1]=last?0x93:0x91;h[2]=0x11;h.writeInt32BE(last?-3:2,4);h.writeUInt32BE(b.length,8);return Buffer.concat([h,b]);}
test('stream bridge forwards PCM once, persists final text and uses no upstream replay',async()=>{
 let upstream,constructed=0;class Fake extends EventEmitter{readyState=1;bufferedAmount=0;sent=[];constructor(){super();upstream=this;constructed++;queueMicrotask(()=>this.emit('open'));}send(b){this.sent.push(b);}terminate(){this.readyState=3;}}
 const writes=[],client=new Client(),pool={query:async(sql,args)=>writes.push({sql,args})};
 const finished=bridge(client,{pool,operationId:'test-operation',reservationId:'test-reservation',WebSocketClass:Fake,key:'test-only'});
 await new Promise(r=>setImmediate(r));assert.equal(client.messages[0].type,'ready');
 client.emit('message',Buffer.alloc(6400),true);upstream.emit('message',response('测试'));
 client.emit('message',Buffer.from('{"type":"stop"}'),false);assert.equal(upstream.sent.at(-1)[1],0x23);
 upstream.emit('message',response('测试成功',true));await finished;
 assert.equal(constructed,1);assert.equal(writes.length,2);assert.equal(writes[0].args[1],'succeeded');assert.equal(JSON.parse(writes[0].args[2]).text,'测试成功');assert.equal(JSON.parse(writes[1].args[2]).duration,.2);assert.equal(client.messages.at(-1).type,'complete');
});
test('disconnect retains partial text and fails without creating another provider connection',async()=>{
 let upstream;class Fake extends EventEmitter{readyState=1;bufferedAmount=0;constructor(){super();upstream=this;queueMicrotask(()=>this.emit('open'));}send(){}terminate(){this.readyState=3;}}
 const writes=[],client=new Client(),pool={query:async(sql,args)=>writes.push(args)};
 const finished=bridge(client,{pool,operationId:'op',reservationId:'budget',WebSocketClass:Fake,key:'test-only'});await new Promise(r=>setImmediate(r));upstream.emit('message',response('已收到的文字'));client.close();await finished;
 assert.equal(writes[0][1],'failed');assert.equal(JSON.parse(writes[0][2]).text,'已收到的文字');
});
test('upgrade rejects untrusted origin and missing FG session before touching company credentials',async()=>{
 const server=http.createServer();let touched=0;const wss=registerSpeechStream(server,{pool:{query:()=>{touched++;}},authenticate:async()=>null,origins:['https://fg.example'],parsePath:url=>({url:new URL(url,'http://localhost')}),readKey:()=>{touched++;}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{for(const origin of ['https://evil.example','https://fg.example']){const code=await new Promise(resolve=>{const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/fg/speech/stream`,{origin});ws.on('unexpected-response',(_r,res)=>{res.resume();ws.terminate();resolve(res.statusCode);});ws.on('error',()=>{});});assert.equal(code,403);}assert.equal(touched,0);}
 finally{wss.close();await new Promise(resolve=>server.close(resolve));}
});
