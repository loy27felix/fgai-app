import test from 'node:test';
import assert from 'node:assert/strict';
import {meilinHeaders,meilinTaskInput,meilinEnabled} from './fg-meilin.mjs';
import {createHmac} from 'node:crypto';
import {capabilities} from './fg-model-capabilities.mjs';

test('director output ceiling follows the selected official text profile',()=>{
 const model={billingId:'gpt-6.1-sol',capability:'text',profile:capabilities({id:'gpt-6.1-sol',capability:'text'})};
 const make=n=>meilinTaskInput(model,{id:'c',protocol:'openai'},{kind:'text',operationId:'op',payload:{max_tokens:n}},'drama',{}).input;
 assert.equal(make(64000).textOptions.maxOutputTokens,64000);
 assert.equal(make(200000).textOptions.maxOutputTokens,128000);
 assert.equal(make(64000).agentRequests.chatCompletion.max_tokens,64000);
});
test('gateway identity is verifiable by the independent application',()=>{
 const actor={id:'72f7e666-928a-4b00-8b01-a49fbf07683b',name:'甲'};
 const h=meilinHeaders(actor,'POST','/api/dramas','only-test-secret');
 assert.deepEqual(JSON.parse(Buffer.from(h['x-fg-meilin-actor'],'base64url').toString()),actor);
 assert.equal(h['x-fg-meilin-signature'],createHmac('sha256','only-test-secret').update([h['x-fg-meilin-actor'],h['x-fg-meilin-time'],'POST','/api/dramas'].join('\n')).digest('hex'));
 assert.throws(()=>meilinHeaders(actor,'POST','/api/config',''));
});
test('feature switch defaults closed for members and supports administrator preview',()=>{
 assert.equal(meilinEnabled({},{}),false);
 assert.equal(meilinEnabled({meilinEnabled:true},{}),true);
 assert.equal(meilinEnabled({}, {reviewer:true}),true);
});
test('native task carries stable operation and project attribution for recovery',()=>{
 const model={billingId:'claude-sonnet-5-5-t3a',capability:'text'};
 const x=meilinTaskInput(model,{id:'c',protocol:'openai'}, {kind:'text',operationId:'op',payload:{messages:[{role:'user',content:'hi'}],max_tokens:200}},'drama',{});
 assert.equal(x.input.metadata.clientOperationId,'meilin-op');
 assert.equal(x.input.metadata.source,'fg-meilin');
 assert.equal(x.input.metadata.meilinDramaId,'drama');
 assert.equal(x.input.textOptions.maxOutputTokens,200);
 assert.equal(x.input.textOptions.stream,true);
 assert.equal(x.input.agentRequests.chatCompletion.stream,true);
 assert.equal(x.input.agentRequests.chatCompletion.max_tokens,200);
});
