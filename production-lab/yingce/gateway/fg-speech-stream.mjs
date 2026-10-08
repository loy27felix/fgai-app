import {createHash} from 'node:crypto';
import WebSocket,{WebSocketServer} from 'ws';
import {speechKey,SpeechError,speechFailure} from './fg-speech-provider.mjs';
import {streamFrame,streamResponse,streamConfig} from './fg-stream-protocol.mjs';
import {reserveBudget} from './fg-budgets.mjs';

export const streamModel='volc.seedasr.sauc.duration';
const upstreamURL='wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
export function registerSpeechStream(server,{pool,authenticate,origins,parsePath,readKey=speechKey,reserve=reserveBudget,connect=bridge}){
 const wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});const active=new Set(),pending=new Set();let shutting=false;
 wss.shutdown=async()=>{shutting=true;for(const client of wss.clients)client.close(1012,'Service restarting');await Promise.allSettled([...pending]);};
 server.on('upgrade',async(req,socket,head)=>{
  let actor,operationId,claimed=false,jobCreated=false,reservationId;
  const reject=status=>{if(!socket.destroyed){socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);}};
  try{
   const path=parsePath(req.url).url;
   if(shutting){reject(503);return;}
   if(path.pathname!=='/api/fg/speech/stream'){reject(404);return;}
   if(!origins.includes(req.headers.origin)){reject(403);return;}
   actor=await authenticate(req);if(!actor){reject(403);return;}
   if(socket.destroyed)return;
   if(active.has(actor.id)||active.size>=8){reject(429);return;}active.add(actor.id);claimed=true;
   operationId=path.searchParams.get('operationId');if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(operationId||'')){reject(400);return;}
   await readKey();
   const input={kind:'streaming',fgAdWorkspaceId:path.searchParams.get('advertising')||undefined};
   const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
   const inserted=await pool.query("INSERT INTO fg_speech_jobs(id,owner_id,operation_id,kind,input_hash,status) VALUES($1,$2,$1,'streaming',$3,'reserved') ON CONFLICT DO NOTHING RETURNING id",[operationId,actor.id,hash]);
   if(!inserted.rowCount){reject(409);return;}
   jobCreated=true;
   const budget=await reserve(pool,{userId:actor.id,model:streamModel,capability:'transcription',payload:input,advertisingWorkspaceId:input.fgAdWorkspaceId});reservationId=budget.id;
   await pool.query("UPDATE fg_speech_jobs SET reservation_id=$2,status='sending' WHERE id=$1",[operationId,budget.id]);
   await pool.query("INSERT INTO fg_speech_usage(reservation_id,request_id,model,status) VALUES($1,$2,$3,'submitted')",[budget.id,operationId,streamModel]);
   if(socket.destroyed)throw Error('Client closed before upstream submission');
   if(shutting)throw Error('Service stopping before submission');
   wss.handleUpgrade(req,socket,head,client=>{const done=connect(client,{pool,actor,operationId,reservationId:budget.id});pending.add(done);void done.finally(()=>{pending.delete(done);active.delete(actor.id);});});claimed=false;jobCreated=false;
  }catch{reject(503);}
  finally{
   if(jobCreated){
    await pool.query("UPDATE fg_speech_jobs SET status='failed',error_code='SPEECH_UPSTREAM_FAILED',updated_at=now() WHERE id=$1",[operationId]).catch(()=>{});
    if(reservationId)await pool.query("UPDATE fg_speech_usage SET status='failed',error_code='SPEECH_UPSTREAM_FAILED' WHERE reservation_id=$1",[reservationId]).catch(()=>{});
   }
   if(claimed&&actor)active.delete(actor.id);
  }
 });
 server.on('close',()=>{for(const c of wss.clients)c.terminate();wss.close();});
 return wss;
}
export async function bridge(client,{pool,operationId,reservationId,WebSocketClass=WebSocket,key}){
 let upstream,ending=false,done=false,sequence=1,bytes=0,latest={text:'',segments:[]},endTimer;
 const send=value=>{if(client.readyState===1)client.send(JSON.stringify(value));};
 let resolveDone;const completed=new Promise(r=>{resolveDone=r;});
 const finish=async(error)=>{
  if(done)return;done=true;clearTimeout(timer);clearTimeout(endTimer);upstream?.terminate();
  const code=error?error instanceof SpeechError?error.code:'SPEECH_UPSTREAM_FAILED':null;
  const result={...latest,usage:{duration:bytes/32000},requestId:operationId};
  try{await pool.query("UPDATE fg_speech_jobs SET status=$2,result=$3,error_code=$4,updated_at=now() WHERE id=$1",[operationId,error?'failed':'succeeded',JSON.stringify(result),code]);await pool.query('UPDATE fg_speech_usage SET status=$2,usage=$3,error_code=$4 WHERE reservation_id=$1',[reservationId,error?'failed':'succeeded',JSON.stringify(result.usage),code]);}
  catch{error=new SpeechError('SPEECH_UPSTREAM_FAILED');}
  send(error?{type:'error',message:error instanceof SpeechError?error.message:'语音服务暂时不可用',code:code||'SPEECH_UPSTREAM_FAILED'}:{type:'complete',...result});
  if(client.readyState===1)client.close(error?1011:1000);resolveDone();
 };
 const stop=()=>{if(ending||done)return;ending=true;if(upstream?.readyState!==1){void finish(new SpeechError('SPEECH_UPSTREAM_FAILED'));return;}upstream.send(streamFrame(Buffer.alloc(0),++sequence,{audio:true,last:true}));endTimer=setTimeout(()=>void finish(new SpeechError('SPEECH_TIMEOUT')),15000);};
 const timer=setTimeout(stop,5*60*1000);
 client.on('error',()=>void finish(new SpeechError('SPEECH_UPSTREAM_FAILED')));
 client.on('close',()=>{if(!done)void finish(new SpeechError('SPEECH_UPSTREAM_FAILED'));});
 client.on('message',(data,binary)=>{
  if(done)return;
  if(!binary){try{if(JSON.parse(data.toString()).type==='stop'){stop();return;}}catch{}void finish(new SpeechError('SPEECH_INVALID_INPUT',400));return;}
  if(ending)return;
  if(upstream?.readyState!==1||data.length===0||data.length%2||data.length>12800||upstream.bufferedAmount>128000){void finish(new SpeechError('SPEECH_INVALID_INPUT',400));return;}
  bytes+=data.length;if(bytes>32000*300){stop();return;}
  upstream.send(streamFrame(data,++sequence,{audio:true}));
 });
 try{
  upstream=new WebSocketClass(upstreamURL,{headers:{'X-Api-Key':key||await speechKey(),'X-Api-Resource-Id':streamModel,'X-Api-Request-Id':operationId},handshakeTimeout:15000,maxPayload:2<<20,perMessageDeflate:false});
  upstream.on('open',()=>{if(done){upstream.terminate();return;}upstream.send(streamFrame(streamConfig,sequence));send({type:'ready',id:operationId,model:streamModel});});
  upstream.on('message',data=>{if(done)return;try{const r=streamResponse(data);latest={text:r.text,segments:r.segments};send({type:'result',...latest});if(r.last)void finish();}catch(error){void finish(error);}});
  upstream.on('unexpected-response',(_req,res)=>{res.resume();void finish(speechFailure(res.statusCode,res.headers['x-api-status-code']));});
  upstream.on('error',()=>void finish(new SpeechError('SPEECH_UPSTREAM_FAILED')));
  upstream.on('close',()=>{if(!done)void finish(new SpeechError('SPEECH_UPSTREAM_FAILED'));});
 }catch(error){void finish(error);}
 return completed;
}
