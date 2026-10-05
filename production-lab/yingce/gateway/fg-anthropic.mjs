import {randomUUID} from 'node:crypto';

// ArcReel's native director uses the Anthropic SDK. Keep its tool contract,
// while execution, admission and billing stay in FG's existing task service.
export function anthropicConversation(payload){
 const messages=[];
 if(payload.system)messages.push({role:'system',content:typeof payload.system==='string'?payload.system:payload.system.filter(x=>x.type==='text').map(x=>x.text).join('\n')});
 if(!Array.isArray(payload.messages))throw Error('导演请求缺少会话内容');
 for(const message of payload.messages){
  if(!['user','assistant'].includes(message.role))throw Error('导演会话角色无效');
  const content=typeof message.content==='string'?[{type:'text',text:message.content}]:message.content;
  const parts=[];
  for(const part of content||[]){
   if(part.type==='text')parts.push({type:'text',text:part.text});
   else if(part.type==='image'&&part.source?.type==='base64'&&/^image\//.test(part.source.media_type))parts.push({type:'image_url',image_url:{url:'data:'+part.source.media_type+';base64,'+part.source.data}});
   else if(part.type==='tool_use'){
    if(parts.length){messages.push({role:message.role,content:parts.splice(0)});}
    messages.push({type:'function_call',call_id:part.id,name:part.name,arguments:JSON.stringify(part.input||{})});
   }else if(part.type==='tool_result'){
    if(parts.length)messages.push({role:message.role,content:parts.splice(0)});
    messages.push({role:'tool',tool_call_id:part.tool_use_id,content:typeof part.content==='string'?part.content:JSON.stringify(part.content||[])});
   }else if(!['thinking','redacted_thinking'].includes(part.type))throw Error('不支持的导演会话内容：'+part.type);
  }
  if(parts.length)messages.push({role:message.role,content:parts});
 }
 const tools=(payload.tools||[]).map(t=>{
  if(!t.name||t.type?.startsWith('computer'))throw Error('导演工具类型无效');
  return {type:'function',function:{name:t.name,description:t.description||'',parameters:t.input_schema||{type:'object',properties:{}}}};
 });
 const choice=payload.tool_choice;
 const toolChoice=choice?.type==='any'?'required':choice?.type==='none'?'none':choice?.type==='tool'?{type:'function',name:choice.name}:'auto';
 if(!messages.length)throw Error('导演请求为空');
 return {canonical:{messages,tools,toolChoice},custom:new Set()};
}
export function anthropicResponse(result,{id='msg_'+randomUUID(),model,usage}={}){
 const content=[];
 if(result.text)content.push({type:'text',text:result.text});
 for(const call of result.toolCalls||[]){const f=call.function||call;content.push({type:'tool_use',id:call.id||'toolu_'+randomUUID(),name:f.name,input:typeof f.arguments==='string'?JSON.parse(f.arguments):f.arguments||{}});}
 return {id,type:'message',role:'assistant',model,content,stop_reason:content.some(x=>x.type==='tool_use')?'tool_use':'end_turn',stop_sequence:null,...(usage?{usage}:{})};
}
export function anthropicStreamEvents(response){
 const out=[{type:'message_start',message:{...response,content:[],stop_reason:null,stop_sequence:null}}];
 response.content.forEach((block,index)=>{
  out.push({type:'content_block_start',index,content_block:block.type==='text'?{type:'text',text:''}:{...block,input:{}}});
  out.push({type:'content_block_delta',index,delta:block.type==='text'?{type:'text_delta',text:block.text}:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
  out.push({type:'content_block_stop',index});
 });
 out.push({type:'message_delta',delta:{stop_reason:response.stop_reason,stop_sequence:null},...(response.usage?{usage:{output_tokens:response.usage.output_tokens}}:{})},{type:'message_stop'});
 return out;
}
