import {test} from 'node:test';
import assert from 'node:assert/strict';
import {admissionPrice,monthStart} from './fg-budgets.mjs';
test('text budget reserves declared maximum output',()=>{
 const price={enabled:true,discount:.85,pricing_rules:{input_price:2,output_price:8}};
 const payload={messages:[{role:'user',content:'测试'}],max_tokens:2000};
 assert.equal(admissionPrice('text','text',payload,price,6.77),(Buffer.byteLength(JSON.stringify(payload))*2+2000*8)/1e6*.85*6.77);
 assert.equal(admissionPrice('unknown','text',payload,{enabled:false},6.77),null);
 assert.equal(admissionPrice('text','text',{messages:[]},price,6.77),null);
 assert.equal(admissionPrice('text','text',{...payload,messages:[{content:[{type:'image_url',image_url:{url:'x'}}]}]},price,6.77),null);
});
test('an incomplete multimodal quote cannot authorize a capped request',()=>{
 const price={enabled:true,discount:1,pricing_rules:{rules:[{tier:'standard',token_type:'Output image',image_size:'1K',price:.04}]}};
 assert.equal(admissionPrice('gemini-3-pro-image-preview','image',{quality:'1K'},price,6.77),null);
 assert.match(monthStart(),/^\d{4}-\d{2}-01T00:00:00\+08:00$/);
});
