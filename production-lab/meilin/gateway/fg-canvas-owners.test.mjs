import test from 'node:test';import assert from 'node:assert/strict';
import {canvasOwnersRoute} from './fg-canvas-owners.mjs';
test('member directory only exposes ordinary-user names and counts to administrators',async()=>{
 let body,query;const pool={async query(sql){query=sql;return {rows:[{id:'member',name:'用户',username:'member',canvas_count:3,email:'private@example.com'}]};}};
 const res={writeHead(){},end(s){body=JSON.parse(s);}};
 await canvasOwnersRoute({method:'GET'},res,{pool,actor:{reviewer:true},path:new URL('https://fg.test/api/fg/canvas/owners')});
 assert(query.includes("platform_role IN ('user','member')"));assert.deepEqual(body.data.owners,[{id:'member',name:'用户',username:'member',canvasCount:3}]);
 await canvasOwnersRoute({method:'GET'},res,{pool:{query(){throw Error('must not query');}},actor:{reviewer:false},path:new URL('https://fg.test/api/fg/canvas/owners')});assert.equal(body.code,403);
});
