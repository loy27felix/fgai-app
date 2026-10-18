// FG text tasks: the gateway owns provider credentials and billing.
import {integrated,context,bridge} from './fg-context.mjs';
import {createHash,randomUUID} from 'node:crypto';

export const liveText = integrated;
export const definitiveGPTFallback=message=>!/制作额度|本月|monthly budget|预算|限额/i.test(String(message))&&/insufficient_quota|quota[_ -]?(?:exhausted|exceeded)|额度(?:不足|用尽|已用完)|余额不足|请先在个人设置.*GPT 接入.*填写/i.test(String(message));

export async function chat({ model, system, messages, maxTokens = 8000, temperature = 0.7, timeoutMs = 180000, streamPresentation = 'status',skillVersions,sourceAction }) {
  if(!integrated)throw Error('模拟模式不调用付费模型');
  const c=context();c.textOrdinal=(c.textOrdinal||0)+1;
  const hash=createHash('sha256').update(`${c.operationId}:${c.textOrdinal}`).digest('hex');
  const operationId=c.operationId?`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`:randomUUID();
  async function execute(selected,id){
  const submitted=await bridge('submit',{operationId:id,kind:'text',model:selected,payload:{messages:[{role:'system',content:system},...messages],max_tokens:maxTokens,temperature},metadata:{episodeId:c.episodeId||null,sourceAction:sourceAction||c.action||'turn',skills:skillVersions??c.skillsUsed??{}}});
  const until=Date.now()+timeoutMs;
  let after=0,text='';c.emit?.('status',{text:'模型正在思考，收到正文后会实时显示。'});
  while(Date.now()<until){const task=await bridge('task',{taskId:submitted.taskId,...(c.emit?{after}:{})});
    for(const delta of task.replay?.deltas||[]){if(delta.sequence>after){after=delta.sequence;text+=delta.content;if(streamPresentation!=='status')c.emit?.('text',{text,format:streamPresentation,action:c.action});}}
    if(task.status==='succeeded')return task.result.text||'';
    if(['failed','cancelled'].includes(task.status)){const error=Error(task.error||'文本任务失败');error.partialOutput=Boolean(text||task.result?.text);throw error;}
    await new Promise(r=>setTimeout(r,1000));
  }
  throw Error('文本任务仍在处理，已保存在 FG 历史；请勿重复提交');
  }
  const chosen=model;
  try{return await execute(chosen,operationId);}catch(error){
   const fallback=(c.models||[]).find(m=>m.capability==='text'&&/claude-sonnet-5-5/.test(m.id));
   if(!/gpt-6\.1-sol/.test(chosen)||!fallback||error.partialOutput||!definitiveGPTFallback(error.message))throw error;
   const digest=createHash('sha256').update(operationId+':sonnet-fallback').digest('hex'),fallbackId=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
   (c.textFallbacks||=[]).push({from:model,to:fallback.id,reason:'个人GPT未绑定或供应商明确返回额度不足'});(c.textFallbackModel||={})[model]=fallback.id;
   return execute(fallback.id,fallbackId);
  }
}

export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('模型没有返回可解析的 JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

// A conversational suggestion without actions is valid. Never infer writes from prose.
export function parseDirectorTurn(text) {
  try {
    const result = parseJson(text);
    if (!result || Array.isArray(result) || typeof result.reply !== 'string' || (result.actions !== undefined && !Array.isArray(result.actions))) throw Error('导演响应结构无效');
    return {...result, actions: result.actions || []};
  } catch (error) {
    if (typeof text === 'string' && text.trim() && !/[\[{}\]]|```/.test(text)) return {reply:text.trim(),actions:[]};
    throw error;
  }
}
