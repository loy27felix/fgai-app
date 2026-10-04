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
