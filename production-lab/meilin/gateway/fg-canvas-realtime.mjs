import http from 'node:http';

// Forward the authenticated native handshake. Platform cookies never reach the native server.
export function registerCanvasRealtime(server,{authenticate,session,origins,parsePath,web,publicOrigin}) {
  server.on('upgrade',async(req,socket,head)=>{
    const path=parsePath(req.url).url;
    if(!/^\/api\/canvas-projects\/[a-zA-Z0-9_-]{1,64}\/realtime$/.test(path.pathname))return;
    const reject=status=>{if(!socket.destroyed)socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);};
    try {
      if(!origins.includes(req.headers.origin)){reject(403);return;}
      const actor=await authenticate(req);
      if(!actor){reject(401);return;}
      const cookie=await session(actor);
      if(socket.destroyed)return;
      const headers={cookie,origin:publicOrigin,upgrade:'websocket',connection:'Upgrade','sec-websocket-key':req.headers['sec-websocket-key'],'sec-websocket-version':req.headers['sec-websocket-version']};
      const upstream=http.request(new URL(path.pathname,web),{headers});
      upstream.setTimeout(15000,()=>upstream.destroy());
      upstream.on('error',()=>reject(503));
      upstream.on('response',response=>{response.resume();reject(response.statusCode===404?404:response.statusCode===401||response.statusCode===403?403:503);});
      upstream.on('upgrade',(response,remote,remoteHead)=>{
        upstream.setTimeout(0);
        if(socket.destroyed){remote.destroy();return;}
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key,value])=>`${key}: ${value}\r\n`).join('')}\r\n`);
        if(remoteHead.length)socket.write(remoteHead);
        if(head.length)remote.write(head);
        remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());
        remote.on('close',()=>socket.destroy());socket.on('close',()=>remote.destroy());
        remote.pipe(socket);socket.pipe(remote);
      });
      socket.once('close',()=>upstream.destroy());
      upstream.end();
    } catch {reject(503);}
  });
}
