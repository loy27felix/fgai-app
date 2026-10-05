import {test} from 'node:test';
import assert from 'node:assert/strict';
import {anthropicConversation,anthropicResponse,anthropicStreamEvents} from './fg-anthropic.mjs';
test('native director tool round trip keeps identifiers and structured inputs',()=>{
 const c=anthropicConversation({system:[{type:'text',text:'导演'}],tools:[{name:'build_scene',input_schema:{type:'object'}}],messages:[{role:'assistant',content:[{type:'tool_use',id:'tool-1',name:'build_scene',input:{x:3}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'tool-1',content:'已完成'}]}]});
 assert.equal(c.canonical.messages[1].call_id,'tool-1');assert.equal(c.canonical.messages[2].tool_call_id,'tool-1');assert.equal(c.canonical.tools[0].function.name,'build_scene');
 const result=anthropicResponse({toolCalls:[{id:'tool-2',function:{name:'build_scene',arguments:'{"x":4}'}}]},{model:'company-model',usage:{input_tokens:12,output_tokens:7}});
 assert.equal(result.stop_reason,'tool_use');assert.deepEqual(result.content[0].input,{x:4});
 assert.deepEqual(anthropicStreamEvents(result).map(x=>x.type),['message_start','content_block_start','content_block_delta','content_block_stop','message_delta','message_stop']);
});
test('external image URLs and unsupported content fail before admission',()=>{
 assert.throws(()=>anthropicConversation({messages:[{role:'user',content:[{type:'image',source:{type:'url',url:'http://localhost/private'}}]}]}));
 const response=anthropicResponse({text:'完成'},{model:'company-model'});assert.equal(response.usage,undefined);
});
