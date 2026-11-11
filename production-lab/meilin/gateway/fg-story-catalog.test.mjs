import {test} from 'node:test';
import assert from 'node:assert/strict';
import {approvedTopics} from './fg-team-stories.mjs';
import {storyCatalogRoute} from './fg-story-catalog.mjs';
test('seed assignments do not reserve stories without a real project',async()=>{
 const pool={query:async()=>({rows:[]})};
 const topics=await approvedTopics(pool,[{id:101,title:'test',selected_by:'seed person',selection_group:'seed group'}]);
 assert.equal(topics[0].selected_by,undefined);
 assert.equal(topics[0].selection_group,undefined);
 assert.equal(topics[0].selected,false);
});
test('real claims replace seed names and catalog tombstones hide stories',async()=>{
 const pool={query:async sql=>({rows:sql.includes('fg_topic_overrides')?[{topic_id:101,deleted_at:'now'}]:sql.includes('JOIN projects')?[{topic_id:102,native_project_id:'project',display_name:'actual owner',group_name:'actual group'}]:[]})};
 const topics=await approvedTopics(pool,[{id:101},{id:102,selected_by:'seed person'}]);assert.equal(topics.length,1);assert.equal(topics[0].selected,true);assert.equal(topics[0].selected_by,'actual owner');assert.equal(topics[0].selection_group,'actual group');
});
test('members cannot edit or delete catalog stories',async()=>{for(const method of ['PUT','DELETE']){let status;await storyCatalogRoute({method},{},{actor:{reviewer:false},path:new URL('http://test/api/fg/topics/23'),send:(_r,_v,s)=>status=s,pool:{connect:()=>{throw Error('must not query')}}});assert.equal(status,403);}});
test('selected stories reject deletion before NAS or record mutations',async()=>{
 let archived=false,status;const client={query:async sql=>({rows:[],rowCount:sql.startsWith('SELECT 1 FROM fg_story_projects')?1:0}),release(){}};
 await storyCatalogRoute({method:'DELETE'},{},{actor:{id:'admin',reviewer:true},path:new URL('http://test/api/fg/topics/23?revision=0'),pool:{connect:async()=>client},topics:[{id:23}],api:async()=>archived=true,send:(_r,_v,s)=>status=s});assert.equal(status,409);assert.equal(archived,false);
});
