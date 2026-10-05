import {randomUUID} from 'node:crypto';
import {internalSpeechAuthorised,synthesizeSpeech,speechModels,speechUtilities,SpeechError} from './fg-speech-provider.mjs';

export async function initializeSpeech(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS fg_speech_usage(
 reservation_id uuid PRIMARY KEY REFERENCES fg_budget_reservations(id),
 request_id uuid NOT NULL,model varchar(80) NOT NULL,status varchar(16) NOT NULL,
 usage jsonb NOT NULL DEFAULT '{}',error_code varchar(60),created_at timestamptz NOT NULL DEFAULT now());`);
}
export async function enabledSpeechModels(pool){
 const rows=(await pool.query(`SELECT cm.model_key FROM channel_models cm JOIN model_channels c ON c.id=cm.channel_id WHERE c.name='火山语音 · FG' AND c.enabled AND cm.enabled AND c.deleted_at IS NULL AND cm.deleted_at IS NULL`)).rows;
 return speechModels.filter(m=>rows.some(r=>r.model_key===m.id));
}
export async function speechInternalRoute(req,res,{pool,path}){
 if(path.pathname!=='/internal/fg/speech/v1/audio/speech')return false;
 const auth=String(req.headers.authorization||'').replace(/^Bearer /,'');
 if(req.method!=='POST'||!internalSpeechAuthorised(auth)){res.writeHead(403);res.end();return true;}
 let reservationId,requestId;
 try{
  reservationId=String(req.headers['x-fg-budget-reservation']||'');
  if(!/^[0-9a-f-]{36}$/.test(reservationId))throw Error('语音请求缺少费用检查记录');
  const reservation=(await pool.query('SELECT model FROM fg_budget_reservations WHERE id=$1',[reservationId])).rows[0];
  let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>65536)throw new SpeechError('SPEECH_INVALID_INPUT',400);chunks.push(c);}
  const input=JSON.parse(Buffer.concat(chunks));
  if(!reservation||reservation.model!==input.model||!(await enabledSpeechModels(pool)).some(m=>m.id===input.model))throw Error('语音费用记录或模型无效');
  requestId=randomUUID();
  const inserted=await pool.query("INSERT INTO fg_speech_usage(reservation_id,request_id,model,status) VALUES($1,$2,$3,'submitted') ON CONFLICT DO NOTHING",[reservationId,requestId,input.model]);
  if(!inserted.rowCount)throw Error('语音请求已提交；请查看原任务，不会重复生成');
  const output=await synthesizeSpeech(input,{requestId});
  await pool.query("UPDATE fg_speech_usage SET status='succeeded',usage=$2 WHERE reservation_id=$1",[reservationId,JSON.stringify(output.usage)]);
  res.writeHead(200,{'content-type':output.format==='wav'?'audio/wav':'audio/mpeg','content-length':output.bytes.length,'cache-control':'no-store','x-fg-speech-request-id':requestId});res.end(output.bytes);
 }catch(error){
  if(requestId)await pool.query("UPDATE fg_speech_usage SET status='failed',error_code=$2 WHERE reservation_id=$1",[reservationId,error instanceof SpeechError?error.code:'FG_SPEECH_FAILED']);
  res.writeHead(error.status||400,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:{message:error instanceof SpeechError?error.message:'语音请求未能完成，请查看制作记录',code:error.code||'FG_SPEECH_FAILED'}}));
 }return true;
}
