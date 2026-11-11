import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {createGatewayShutdown} from './fg-gateway-shutdown.mjs';

test('shutdown drains open SSE and upgraded connections and closes dependencies once',async()=>{
 let closed=0,streams=0;
 const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: ready\n\n');});
 server.on('upgrade',(_req,socket)=>socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n'));
 const shutdown=createGatewayShutdown([server],{graceMs:20,shutdownStreams:async()=>{streams++;},closeDependencies:async()=>{closed++;}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=server.address().port;
 const request=http.get(`http://127.0.0.1:${port}/events`);request.on('error',()=>{});
 const [response]=await once(request,'response');response.on('error',()=>{});response.resume();
 const upgraded=net.connect(port,'127.0.0.1');upgraded.on('error',()=>{});
 upgraded.write('GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n');await once(upgraded,'data');
 const finished=shutdown();assert.equal(shutdown(),finished);await finished;
 assert.equal(server.listening,false);assert.equal(streams,1);assert.equal(closed,1);
 response.destroy();request.destroy();upgraded.destroy();
});
