import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHmac} from 'node:crypto';
import {adcraftInternalRoute,adcraftUserRoute,advertisingAccess,budgetCharge,tokenContext,adcraftServiceFailure} from './fg-adcraft.mjs';

process.env.FG_ADCRAFT_SECRET='unit-test-only-secret';
test('NAS unavailability is visible without exposing upstream private errors',()=>{
 assert.match(adcraftServiceFailure({detail:'NAS 未挂载，广告工程已停止写入'},503),/NAS 连接暂不可用/);
 assert.match(adcraftServiceFailure({detail:{message:'NAS 未挂载'}},503),/NAS 连接暂不可用/);
 assert.doesNotMatch(adcraftServiceFailure({detail:'token=private-secret'},500),/private-secret/);
 assert.match(adcraftServiceFailure(null,404),/保留原工程关联/);
});
test('opening an existing advertising project preserves its mapping during a NAS outage',async()=>{
 const f=fixture(),saved=global.fetch,query=f.pool.query;let writes=0;
 f.pool.query=async(sql,args)=>{
  if(sql.startsWith('SELECT w.*'))return {rows:[{id:workspace,owner_id:actor,adcraft_project_id:'native-existing'}]};
  if(sql.startsWith('UPDATE'))writes++;
  return query(sql,args);
 };
 global.fetch=async(url,options)=>{
  assert.equal(options.method,undefined);assert.match(String(url),/projects\/native-existing$/);
  return Response.json({detail:'NAS 未挂载，广告工程已停止写入'},{status:503});
 };
 try{
  const req=Readable.from([]);req.method='POST';req.headers={};let status,response;
  const res={writeHead(s){status=s;},end(body){response=JSON.parse(body);}};
  await adcraftUserRoute(req,res,{pool:f.pool,actor:{id:actor},cookie:'test',web:'http://mock',publicOrigin:'https://fg.invalid',path:new URL('http://gateway/api/fg/advertising/'+workspace+'/open')});
  assert.equal(status,503);assert.match(response.msg,/NAS 连接暂不可用/);assert.equal(writes,0);
 }finally{global.fetch=saved;}
});
const workspace='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002';
function token(operation='test-operation'){
 const raw=Buffer.from(JSON.stringify({workspace,actor,operation})).toString('base64url');return raw+'.'+createHmac('sha256',process.env.FG_ADCRAFT_SECRET).update(raw).digest('hex');
}
function fixture(budget=100){
 const jobs=new Map(),submissions=[];let reads=0;
 const pool={query:async(sql,args=[])=>{
   if(sql.includes('FROM fg_accounts')||sql.includes('JOIN fg_accounts'))return {rows:[{id:actor,name:'测试账号',email:'test@fg.invalid',platform_role:'user'}]};
   if(sql.startsWith('SELECT w.*'))return {rows:[{id:workspace,owner_id:actor,native_project_id:'fg-project',budget_cny:budget}]};
   if(sql.startsWith('SELECT budget_cny'))return {rows:[{budget_cny:budget}]};
   if(sql.includes('FROM channel_models'))return {rows:[{channel_id:'company-wetoken',protocol:'chat-completion',api_format:'openai'}]};
   if(sql.startsWith('SELECT DISTINCT p.model'))return {rows:['gpt-5.6-sol-t1a','claude-opus-5-5-t3a','seedream-5-0-lite-260128','doubao-seedance-2-0-fast-filter-off'].map(model=>({model,snapshot:{enabled:true,discount:1,quota_type:1,model_price:.05,pricing_rules:{input_price:2,output_price:8,type:'per_second',rules:[{resolution:'480p',price:.012,scenario:'without_video_input'}]}}}))};
   if(sql.includes('FROM fg_model_prices'))return {rows:[{snapshot:{enabled:true,discount:1,quota_type:1,model_price:.05,pricing_rules:{input_price:2,output_price:8,type:'per_second',rules:[{resolution:'480p',price:.012,scenario:'without_video_input'}]}}}]};
   if(sql.includes('FROM fg_company_settings'))return {rows:[{value:6.77}]};
   if(sql.includes('logical_key=$2'))return {rows:[...jobs.values()].filter(j=>j.logical_key===args[1])};
   if(sql.includes('j.reserved_cny,count(c.id)'))return {rows:[...jobs.values()].map(j=>({reserved_cny:j.reserved_cny,billable_count:0,matched_count:0}))};
   if(sql.startsWith('INSERT INTO fg_adcraft_jobs')){jobs.set(args[0],{id:args[0],workspace_id:args[1],actor_id:args[2],logical_key:args[3],mode:args[4],reserved_cny:args[5],status:'reserved'});return {rows:[]};}
   if(sql.includes("SET task_id=$2")){Object.assign(jobs.get(args[0]),{task_id:args[1],status:'submitted'});return {rows:[]};}
   return {rows:[]};
 },connect:async()=>({...pool,release(){}})};
 const nativeFetch=async(url,options={})=>{
  const pathname=new URL(url).pathname;
  if(pathname==='/api/tasks') {const payload=JSON.parse(options.body);submissions.push(payload);return Response.json({code:0,data:{id:'test-task-'+submissions.length}});}
  if(pathname.startsWith('/api/tasks/')){reads++;const type=submissions.at(-1).input.mode;return Response.json({code:0,data:{status:'succeeded',resultJson:JSON.stringify(type==='text'?{text:'已执行',toolCalls:[{id:'tool-1',type:'function',function:{name:'write_script',arguments:'{"title":"测试"}'}}]}:type==='video'?{video:{resourceId:'nas-video'}}:{images:[{resourceId:'nas-image'}]})}});}
  if(pathname==='/api/resources/access'){assert.ok(Array.isArray(JSON.parse(options.body)));return Response.json({code:0,data:{items:[{access:{url:'https://fg.invalid/signed-nas-media'}}]}});}
  throw Error('Unexpected outbound request: '+url);
 };
 return {pool,submissions,jobs,nativeFetch,get reads(){return reads;}};
}
async function invoke(f,path,payload,auth=token()){
 const req=Readable.from([Buffer.from(JSON.stringify(payload))]);req.method='POST';req.headers={authorization:'Bearer '+auth};let status,response;
 const res={writeHead(s){status=s;},end(body){response=JSON.parse(body);}};
 await adcraftInternalRoute(req,res,{pool:f.pool,web:new URL('http://mock-fg'),publicOrigin:'https://fg.invalid',canvasSession:async()=> 'test-session',path:new URL('/internal/adcraft/'+workspace+path,'http://gateway')});
 return {status,response};
}
test('bridge identity is signed and workspace-bound',()=>{
 assert.equal(tokenContext(token(),workspace).actor,actor);
 assert.throws(()=>tokenContext(token().replace(/.$/,'z'),workspace));
 assert.throws(()=>tokenContext(token(),'00000000-0000-4000-8000-000000000004'));
});
test('invalid workspace is rejected before database access',async()=>{
 assert.equal(await advertisingAccess({query:()=>{throw Error('DB must not be queried');}},{id:actor},'../other'),null);
});
for(const [mode,path,payload] of [
 ['text','/v1/chat/completions',{model:'gpt-5.6-sol-t1a',messages:[{role:'user',content:'写广告脚本'}],max_tokens:100}],
 ['image','/images/generations',{prompt:'产品广告参考',size:'2048x2048'}],
 ['video','/contents/generations/tasks',{content:[{type:'text',text:'产品特写'}],duration:5,resolution:'480p',generate_audio:true}],
])test(mode+' uses FG queue, project attribution and NAS result without external model calls',async()=>{
 const f=fixture();const saved=global.fetch;global.fetch=f.nativeFetch;
 try{const result=await invoke(f,path,payload);assert.equal(result.status,200,JSON.stringify(result.response));assert.equal(f.submissions.length,1);const task=f.submissions[0];assert.equal(task.projectId,'fg-project');assert.equal(task.input.metadata.adcraftWorkspaceId,workspace);assert.equal(task.input.config.channelId,'company-wetoken');assert.ok([...f.jobs.values()][0].reserved_cny>0);
  if(mode==='text'){assert.equal(result.response.choices[0].message.tool_calls[0].function.name,'write_script');assert.equal(task.input.agentRequests.chatCompletion.model,'gpt-5.6-sol-t1a');}
  if(mode==='image')assert.equal(result.response.data[0].url,'https://fg.invalid/signed-nas-media');
  if(mode==='video'){assert.equal(task.input.config.videoGenerateAudio,'true');assert.equal(result.response.id,'test-task-1');}
  const repeat=await invoke(f,path,payload);assert.equal(repeat.status,200);assert.equal(f.submissions.length,1,'same operation cannot submit twice');
 }finally{global.fetch=saved;}
});
test('budget rejects a request before creating a paid task',async()=>{
 const f=fixture(.001),saved=global.fetch;global.fetch=f.nativeFetch;
 try{const result=await invoke(f,'/images/generations',{prompt:'产品图'});assert.equal(result.status,400);assert.match(result.response.error.message,/预算不足/);assert.equal(f.submissions.length,0);}finally{global.fetch=saved;}
});
test('unsigned caller cannot create a paid task',async()=>{
 const f=fixture();const result=await invoke(f,'/images/generations',{prompt:'产品图'},'invalid');assert.equal(result.status,400);assert.equal(f.submissions.length,0);
});
test('selected text model is preserved and unsupported IDs fail before submission',async()=>{
 const f=fixture(),saved=global.fetch;global.fetch=f.nativeFetch;
 try{const selected=await invoke(f,'/v1/chat/completions',{model:'claude-opus-5-5-t3a',messages:[{role:'user',content:'脚本'}],max_tokens:100});assert.equal(selected.status,200);assert.equal(f.submissions[0].model,'claude-opus-5-5-t3a');assert.equal(f.submissions[0].input.agentRequests.chatCompletion.model,'claude-opus-5-5-t3a');
 const denied=await invoke(f,'/v1/chat/completions',{model:'gemini-3.5-pro',messages:[{role:'user',content:'脚本'}]});assert.equal(denied.status,400);assert.equal(f.submissions.length,1);
 }finally{global.fetch=saved;}
});
test('budget uses fully matched receipts and releases only proven unsent work',()=>{
 assert.equal(budgetCharge({reserved_cny:20,settled_cny:1.5,billable_count:1,matched_count:1}),1.5);
 assert.equal(budgetCharge({reserved_cny:20,settled_cny:1.5,billable_count:2,matched_count:1}),20);
 assert.equal(budgetCharge({reserved_cny:1,settled_cny:2,billable_count:2,matched_count:1}),2);
 assert.equal(budgetCharge({reserved_cny:20,billable_count:0,matched_count:0}),20);
 assert.equal(budgetCharge({reserved_cny:20,not_sent:true}),0);
});
test('FG project creation unwraps the native project envelope',async()=>{
 const f=fixture(),saved=global.fetch;let inserted;
 const query=f.pool.query;
 f.pool.query=async(sql,args)=>{if(sql.startsWith('INSERT INTO fg_adcraft_workspaces'))inserted=args;return query(sql,args);};
 global.fetch=async(url,options)=>{assert.equal(new URL(url).pathname,'/api/projects');assert.equal(JSON.parse(options.body).type,'advertising');return Response.json({code:0,data:{project:{id:'native-fg-project'}}});};
 try{
  const req=Readable.from([Buffer.from(JSON.stringify({name:'免费验收',brief:'仅验证广告工程创建',budgetCny:10}))]);req.method='POST';req.headers={};let response,status;
  const res={writeHead(s){status=s;},end(text){response=JSON.parse(text);}};
  assert.equal(await adcraftUserRoute(req,res,{pool:f.pool,actor:{id:actor,reviewer:false},cookie:'test-session',web:'http://mock-fg',publicOrigin:'https://fg.invalid',path:new URL('http://gateway/api/fg/advertising')}),true);
  assert.equal(status,200,JSON.stringify(response));assert.equal(response.data.projectId,'native-fg-project');assert.equal(inserted[2],'native-fg-project');
 }finally{global.fetch=saved;}
});
test('company asset imports accept native FG IDs and carry trusted project identity',async()=>{
 const f=fixture(),saved=global.fetch,query=f.pool.query;const asset='fgAssetWithoutUuid_123';
 f.pool.query=async(sql,args)=>{
  if(sql.startsWith('SELECT w.*'))return {rows:[{id:workspace,owner_id:actor,adcraft_workflow_id:'native-workflow'}]};
  if(sql.includes('FROM fg_company_assets'))return {rows:[{id:asset,resource_id:'nas-original',title:'公司角色',kind:'image'}]};
  return query(sql,args);
 };
 let imported=false;
 global.fetch=async(url,options)=>{
  if(new URL(url).pathname==='/api/resources/nas-original/file')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});
  assert.match(String(url),new RegExp('/w/'+workspace+'/api/v2/workflows/native-workflow/assets/upload$'));
  assert.equal(options.headers['x-fg-actor'],actor);assert.equal((await options.body.get('file').arrayBuffer()).byteLength,3);imported=true;
  return Response.json({asset_id:'native-image'});
 };
 try{
  const req=Readable.from([Buffer.from(JSON.stringify({assetId:asset}))]);req.method='POST';req.headers={'x-fg-actor':'forged'};let status,response;
  const res={writeHead(s){status=s;},end(body){response=JSON.parse(body);}};
  await adcraftUserRoute(req,res,{pool:f.pool,actor:{id:actor,reviewer:false},cookie:'test-session',web:'http://mock-fg',publicOrigin:'https://fg.invalid',path:new URL('http://gateway/api/fg/advertising/'+workspace+'/company-asset')});
  assert.equal(status,200,JSON.stringify(response));assert.equal(imported,true);
 }finally{global.fetch=saved;}
});
