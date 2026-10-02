import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStory,storyVisible,canReview,importedGroupID} from './fg-team-stories.mjs';
test('legacy non UUID groups import consistently without merging distinct groups',()=>{
 const id=importedGroupID('production-group-1');
 assert.match(id,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
 assert.equal(importedGroupID('production-group-1'),id);
 assert.notEqual(importedGroupID('production-group-2'),id);
 assert.equal(importedGroupID('12345678-1234-1234-1234-123456789012'),'12345678-1234-1234-1234-123456789012');
});
test('story review stays restricted when the module is opened to everyone',()=>{
 assert.equal(canReview({reviewer:false}),false);
 assert.equal(storyVisible({status:'pending',submitted_by:'alice'},{id:'bob',reviewer:false}),false);
 assert.equal(storyVisible({status:'pending',submitted_by:'alice'},{id:'alice',reviewer:false}),true);
 assert.equal(storyVisible({status:'approved',submitted_by:'alice'},{id:'bob',reviewer:false}),true);
 assert.equal(storyVisible({status:'pending',submitted_by:'alice'},{id:'boss',reviewer:true}),true);
});
test('story submission requires useful production context and rejects oversized data',()=>{
 const input={title:'示例',original:'神话原型',characters:'主角与对手',plot:'故事梗概',conflict:'现代冲突',style:'2D',markets:'北美',form:'动画'};
 assert.equal(validateStory(input).original,'神话原型');
 assert.throws(()=>validateStory({...input,characters:''}));
 assert.throws(()=>validateStory({...input,plot:'a'.repeat(6001)}));
 assert.equal(validateStory({...input,status:'approved',submitted_by:'someone'}).status,undefined);
});
