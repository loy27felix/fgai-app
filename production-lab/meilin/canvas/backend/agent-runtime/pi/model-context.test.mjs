import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bridgeModelContext} from './model-context.mjs';

test('Pi transcript deltas preserve platform tools and rendered policy at the Go bridge',()=>{
 const schema={type:'object',properties:{}};
 const context={messages:[
  {role:'system',content:'',sections:{policy:'Use the canvas tools.'},toolsAdded:[{name:'canvas_get_state',description:'read',parameters:schema},{name:'generate_media',parameters:schema}],timestamp:1},
  {role:'user',content:'Create two images',timestamp:2},
  {role:'system',content:'',sections:{policy:'Generate after approval.'},toolsRemoved:[{name:'canvas_get_state'}],toolsAdded:[{name:'canvas_apply_ops',parameters:schema}],timestamp:3}
 ]};
 const projected=bridgeModelContext(context);
 assert.deepEqual(projected.tools.map(t=>t.name).sort(),['canvas_apply_ops','generate_media']);
 assert.match(projected.systemPrompt,/Generate after approval/);
 assert.match(projected.messages[0].content,/Use the canvas tools/);
 assert.match(projected.messages[2].content,/Generate after approval/);
 assert.equal(context.messages[0].content,'');
});
