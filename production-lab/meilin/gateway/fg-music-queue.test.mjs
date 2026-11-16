import test from 'node:test';import assert from 'node:assert/strict';
import {musicBrief,musicQueueRoute} from './fg-music-queue.mjs';
test('music briefs require lyrics for songs and drop lyrics for instrumental',()=>{
 assert.throws(()=>musicBrief({styles:'piano'}));
 assert.equal(musicBrief({styles:'piano',voice:'instrumental',lyrics:'unused'}).lyrics,'');
 assert.equal(musicBrief({styles:'piano',lyrics:'Original verse',model:'chirp-hawk-wild'}).model,'chirp-hawk-wild');
 assert.throws(()=>musicBrief({mode:'inspiration',description:'',model:'../../secret'}));
});
test('ordinary members cannot claim or complete another member music job',async()=>{
 const pool={query(){throw Error('Database must not be accessed before reviewer check');}};
 for(const suffix of ['start','complete']){
  let status,output;const res={writeHead(v){status=v;},end(v){output=JSON.parse(v);}};
  const accepted=await musicQueueRoute({method:'POST'},res,{pool,actor:{id:'member',reviewer:false},path:new URL('http://fg/api/fg/music/jobs/00000000-0000-4000-a000-000000000001/'+suffix)});
  assert.equal(accepted,true);assert.equal(status,403);assert.equal(output.data,null);
 }
});
test('music playback cannot disclose another member resource to a non-reviewer',async()=>{
 const pool={async query(){return {rows:[{owner_id:'alice',status:'succeeded',resource_id:'private'}]};}};
 let status;const res={writeHead(value){status=value;},end(){}};
 await musicQueueRoute({method:'GET'},res,{pool,actor:{id:'bob',reviewer:false},path:new URL('http://fg/api/fg/music/jobs/00000000-0000-4000-a000-000000000001/access'),ownerAPI(){throw Error('must not access owner files');}});
 assert.equal(status,404);
});

test('single music job lookup preserves owner isolation beyond the recent queue',async()=>{
 const pool={async query(){return {rows:[{id:'job',owner_id:'alice',status:'succeeded',resource_id:'private',brief:{title:'saved'}}]};}};
 for(const actor of [{id:'alice',reviewer:false},{id:'bob',reviewer:false}]){
  let status,output;const res={writeHead(value){status=value;},end(value){output=JSON.parse(value);}};
  await musicQueueRoute({method:'GET'},res,{pool,actor,path:new URL('http://fg/api/fg/music/jobs/00000000-0000-4000-a000-000000000001')});
  assert.equal(status,actor.id==='alice'?200:404);
  if(actor.id==='alice')assert.equal(output.data.resourceId,'private');else assert.equal(output.data,null);
 }
});
