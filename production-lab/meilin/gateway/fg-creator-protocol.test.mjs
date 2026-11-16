import {test} from 'node:test';import assert from 'node:assert/strict';
import {creatorConversation,creatorResponse,creatorStreamEvents} from './fg-creator-protocol.mjs';
test('Responses preserves function calls, results and custom patch inputs',()=>{
 const payload={instructions:'Write safely',tools:[{type:'custom',name:'apply_patch'}],input:[{role:'user',content:[{type:'input_text',text:'edit'}]},{type:'custom_tool_call',name:'apply_patch',call_id:'c1',input:'*** Begin Patch'},{type:'custom_tool_call_output',call_id:'c1',output:'ok'}]};
 const {canonical,custom}=creatorConversation(payload);assert.equal(canonical.messages[2].arguments,'{"input":"*** Begin Patch"}');assert.equal(canonical.messages[3].tool_call_id,'c1');
 const response=creatorResponse({text:'done',toolCalls:[{id:'c2',function:{name:'apply_patch',arguments:'{"input":"patch"}'}}]},{model:'company-model',custom});
 assert.equal(response.output[1].input,'patch');const events=creatorStreamEvents(response);assert.equal(events.at(-1).response,response);assert.equal(events.filter(e=>e.type==='response.output_item.done').length,2);assert.equal(events.find(e=>e.type==='response.custom_tool_call_input.done').input,'patch');
 assert.equal(response.usage,undefined,'unknown provider usage must not be fabricated');
});
test('unsupported provider tools and external attachment URLs fail closed',()=>{
 assert.throws(()=>creatorConversation({input:'x',tools:[{type:'web_search_preview'}]}),/工具类型/);
 assert.throws(()=>creatorConversation({input:[{role:'user',content:[{type:'input_image',image_url:'http://127.0.0.1/secrets'}]}]}),/任意外部/);
 assert.throws(()=>creatorResponse({toolCalls:[{id:'x',function:{name:'patch',arguments:'{}'}}]},{custom:new Set(['patch'])}),/无效/);
});
test('namespaced function calls retain identity through provider calls, history and SSE',()=>{
 const schema={type:'object',properties:{jobId:{type:'string'}},required:['jobId']};
 const payload={input:[{type:'function_call',namespace:'creator',name:'read',call_id:'c1',arguments:'{"jobId":"job"}'},{type:'function_call_output',call_id:'c1',output:'ready'}],tools:[{type:'namespace',name:'creator',description:'Read a creator job',tools:[{type:'function',name:'read',parameters:schema}]},{type:'namespace',name:'library',tools:[{type:'function',name:'read',parameters:schema}]},{type:'function',name:'read',parameters:schema}],tool_choice:{type:'function',namespace:'creator',name:'read'}};
 const conversation=creatorConversation(payload),names=conversation.canonical.tools.map(t=>t.function.name);
 assert.equal(new Set(names).size,3);assert(names.every(n=>n.length<=64));assert.equal(conversation.canonical.messages[0].name,names[0]);assert.equal(conversation.canonical.toolChoice.name,names[0]);assert.deepEqual(conversation.canonical.tools[0].function.parameters,schema);
 const response=creatorResponse({toolCalls:[{id:'c2',function:{name:names[1],arguments:'{}'}}]},conversation);
 assert.equal(response.output[0].name,'read');assert.equal(response.output[0].namespace,'library');assert.equal(creatorStreamEvents(response).find(e=>e.type==='response.output_item.done').item.namespace,'library');
 assert.throws(()=>creatorResponse({toolCalls:[{id:'bad',function:{name:'undeclared',arguments:'{}'}}]},conversation),/未声明/);
});
test('namespaced custom tools round trip without confusing equal unqualified names',()=>{
 const conversation=creatorConversation({input:'edit',tools:[{type:'namespace',name:'editor',tools:[{type:'custom',name:'patch'}]},{type:'custom',name:'patch'}]});
 const name=conversation.canonical.tools[0].function.name;
 const response=creatorResponse({toolCalls:[{id:'p1',function:{name,arguments:'{"input":"patch"}'}}]},conversation);
 assert.deepEqual({name:response.output[0].name,namespace:response.output[0].namespace,input:response.output[0].input},{name:'patch',namespace:'editor',input:'patch'});
 assert.throws(()=>creatorConversation({input:'x',tools:[{type:'namespace',name:'outer',tools:[{type:'namespace',name:'inner',tools:[]}]}]}),/命名空间/);
 assert.throws(()=>creatorConversation({input:'x',tools:[{type:'namespace',name:'a',tools:[{type:'web_search'}]}]}));
 assert.equal(creatorConversation({input:'x',tool_choice:'none'}).canonical.toolChoice,'none');
});
