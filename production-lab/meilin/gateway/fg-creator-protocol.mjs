import {createHash,randomUUID} from 'node:crypto';

function providerToolName(name,namespace){
 if(typeof name!=='string'||!name||namespace!==undefined&&(typeof namespace!=='string'||!namespace))throw Error('创作者工具名称无效');
 // Chat providers do not accept Responses namespaces. An opaque, bounded alias
 // avoids collisions between equal tool names in separate namespaces.
 return namespace===undefined?name:'fg_ns_'+createHash('sha256').update(JSON.stringify([namespace,name])).digest('hex').slice(0,48);
}

// Codex is an execution engine. Translate its Responses conversation into the
// existing protocol-neutral FG Agent contract rather than bypassing FG billing.
export function creatorConversation(payload){
 const custom=new Set(),tools=[],toolNames=new Map();
 function addTool(tool,namespace,description=''){
  if(tool.type==='namespace'){
   if(namespace!==undefined||!Array.isArray(tool.tools)||typeof tool.name!=='string'||!tool.name)throw Error('创作者工具命名空间无效');
   for(const child of tool.tools)addTool(child,tool.name,tool.description||'');
   return;
  }
  if(!['function','custom'].includes(tool.type))throw Error('此公司模型适配尚不支持工具类型：'+tool.type);
  const name=providerToolName(tool.name,namespace);
  if(toolNames.has(name))throw Error('创作者工具名称重复');
  toolNames.set(name,{name:tool.name,...(namespace===undefined?{}:{namespace})});
  const help=[namespace?`Namespace: ${namespace}`:'',description,tool.description||''].filter(Boolean).join('\n');
  if(tool.type==='function')tools.push({type:'function',function:{name,description:help,parameters:tool.parameters||{type:'object',properties:{}}}});
  else if(tool.type==='custom'){custom.add(name);tools.push({type:'function',function:{name,description:help+'\nReturn the complete tool input in the input string.',parameters:{type:'object',properties:{input:{type:'string'}},required:['input'],additionalProperties:false}}});}
  else throw Error('此公司模型适配尚不支持工具类型：'+tool.type);
 }
 for(const tool of payload.tools||[])addTool(tool);
 const messages=[];
 if(payload.instructions)messages.push({role:'system',content:String(payload.instructions)});
 const input=typeof payload.input==='string'?[{role:'user',content:payload.input}]:payload.input;
 if(!Array.isArray(input))throw Error('创作者请求缺少会话内容');
 for(const item of input){
  if(item.type==='reasoning')continue;
  if(item.type==='function_call')messages.push({type:'function_call',call_id:item.call_id,name:providerToolName(item.name,item.namespace??undefined),arguments:item.arguments});
  else if(item.type==='custom_tool_call'){const name=providerToolName(item.name,item.namespace??undefined);custom.add(name);messages.push({type:'function_call',call_id:item.call_id,name,arguments:JSON.stringify({input:item.input})});}
  else if(['function_call_output','custom_tool_call_output'].includes(item.type))messages.push({role:'tool',tool_call_id:item.call_id,content:typeof item.output==='string'?item.output:JSON.stringify(item.output)});
  else if(item.role){
   const content=typeof item.content==='string'?item.content:(item.content||[]).map(part=>{
    if(['input_text','output_text','text'].includes(part.type))return {type:'text',text:part.text};
    if(part.type==='input_image'&&/^data:image\//.test(part.image_url||''))return {type:'image_url',image_url:{url:part.image_url}};
    throw Error('请把资料文件上传到创作者工程；不接受任意外部资源链接');
   });
   messages.push({role:item.role==='developer'?'system':item.role,content});
  }else throw Error('不支持的创作者会话条目：'+item.type);
 }
 if(!messages.length)throw Error('创作者请求为空');
 let toolChoice='auto';
 if(['required','none'].includes(payload.tool_choice))toolChoice=payload.tool_choice;
 else if(['function','custom'].includes(payload.tool_choice?.type))toolChoice={type:'function',name:providerToolName(payload.tool_choice.name,payload.tool_choice.namespace??undefined)};
 return {canonical:{messages,tools,toolChoice,promptCacheKey:payload.prompt_cache_key||''},custom,toolNames};
}
export function creatorResponse(result,{id='resp_'+randomUUID(),model,custom=new Set(),toolNames=new Map()}={}){
 const output=[];
 if(result.text)output.push({id:'msg_'+randomUUID(),type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:result.text,annotations:[]}]});
 for(const call of result.toolCalls||[]){const f=call.function||call,identity=toolNames.get(f.name)||{name:f.name};
  if(toolNames.size&&!toolNames.has(f.name))throw Error('模型返回了未声明的工具');
  if(custom.has(f.name)){let data;try{data=JSON.parse(f.arguments);}catch{throw Error('模型返回的自定义工具输入无效');}if(typeof data.input!=='string')throw Error('模型返回的自定义工具输入无效');output.push({id:'ctc_'+randomUUID(),type:'custom_tool_call',status:'completed',call_id:call.id,...identity,input:data.input});}
  else output.push({id:'fc_'+randomUUID(),type:'function_call',status:'completed',call_id:call.id,...identity,arguments:f.arguments});
 }
 return {id,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model,output,error:null,incomplete_details:null};
}
export function creatorStreamEvents(response){
 const events=[],emit=(type,data)=>events.push({type,sequence_number:events.length,...data});
 emit('response.created',{response:{...response,status:'in_progress',output:[]}});
 emit('response.in_progress',{response:{...response,status:'in_progress',output:[]}});
 response.output.forEach((item,output_index)=>{
  emit('response.output_item.added',{output_index,item:{...item,status:'in_progress',...(item.type==='message'?{content:[]}:item.type==='function_call'?{arguments:''}:{input:''})}});
  if(item.type==='message'){
   const part=item.content[0];emit('response.content_part.added',{item_id:item.id,output_index,content_index:0,part:{...part,text:''}});
   emit('response.output_text.delta',{item_id:item.id,output_index,content_index:0,delta:part.text});
   emit('response.output_text.done',{item_id:item.id,output_index,content_index:0,text:part.text});
   emit('response.content_part.done',{item_id:item.id,output_index,content_index:0,part});
  }else if(item.type==='function_call'){
   emit('response.function_call_arguments.delta',{item_id:item.id,output_index,delta:item.arguments});emit('response.function_call_arguments.done',{item_id:item.id,output_index,arguments:item.arguments});
  }else{
   emit('response.custom_tool_call_input.delta',{item_id:item.id,output_index,delta:item.input});emit('response.custom_tool_call_input.done',{item_id:item.id,output_index,input:item.input});
  }
  emit('response.output_item.done',{output_index,item});
 });
 emit('response.completed',{response});return events;
}
