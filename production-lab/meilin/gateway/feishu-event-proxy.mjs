import http from 'node:http';
import {pipeline} from 'node:stream';

// Feishu cannot carry an FG login. Only its exact callback is public;
// the native backend still verifies enablement, token and event signature.
export async function feishuEventRoute(req,res,{path,web}) {
  if(req.method!=='POST'||path.pathname!=='/api/integrations/feishu/events'||path.search)return false;
  const fail=(status,reason)=>{if(!res.headersSent){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({code:status,msg:reason}));}};
  const chunks=[];let size=0;
  try {
    for await(const chunk of req){
      size+=chunk.length;
      if(size>1024*1024){fail(413,'飞书事件超过大小限制');return true;}
      chunks.push(chunk);
    }
  } catch {fail(400,'飞书事件读取失败');return true;}
  const body=Buffer.concat(chunks);
  const headers={'content-type':'application/json','content-length':String(body.length)};
  for(const name of ['x-lark-request-timestamp','x-lark-request-nonce','x-lark-signature'])if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
  const upstream=http.request(new URL('/api/integrations/feishu/events',web),{method:'POST',headers},remote=>{
    res.writeHead(remote.statusCode||502,{'content-type':'application/json','cache-control':'no-store'});
    pipeline(remote,res,()=>{});
  });
  upstream.setTimeout(15000,()=>upstream.destroy(new Error('timeout')));
  upstream.on('error',()=>{if(!res.headersSent)fail(502,'飞书反馈服务暂时不可用');else res.destroy();});
  res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
  upstream.end(body);
  return true;
}
