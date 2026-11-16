import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DEFAULT_PROMPT_SOURCES,parseJsonSource,parseMarkdownSource,promptImageOriginalUrl} from './fg-inspiration-parser.mjs';
import {catalogSources,normalizeCatalog} from './fg-inspiration-catalog.mjs';
import {initializePersonalInspiration,personalInspirationRoute,personalInspirationState,sharedPersonalInspirations} from './fg-inspiration-personal.mjs';
import {isPublicDemo} from './fg-public-demo.mjs';

export const inspirationSources=[...DEFAULT_PROMPT_SOURCES.map(s=>({...s,kind:/seedance/i.test(s.id)?'video':'image'})),...catalogSources];
export const inspirationCategories=[
 {id:'portrait',name:'人物与角色',pattern:/人像|头像|肖像|人物|角色|portrait|character|selfie/i},
 {id:'product',name:'产品与广告',pattern:/广告|产品|商品|电商|品牌|advertis|product|commercial|brand/i},
 {id:'poster',name:'海报与设计',pattern:/海报|设计|排版|封面|poster|design|typography|thumbnail/i},
 {id:'anime',name:'动漫与插画',pattern:/动漫|漫画|插画|手绘|水彩|anime|cartoon|illustrat|watercolor/i},
 {id:'cinema',name:'电影与故事',pattern:/电影|剧情|短片|故事|cinema|film|story|trailer/i},
 {id:'action',name:'动作与运镜',pattern:/动作|跑酷|运镜|镜头|武侠|战斗|action|camera|parkour|battle/i},
 {id:'nature',name:'自然与旅行',pattern:/自然|风景|旅行|植物|nature|landscape|travel|botanical/i},
 {id:'space',name:'建筑与空间',pattern:/建筑|城市|室内|空间|architecture|interior|city|room/i},
 {id:'food',name:'美食与生活',pattern:/美食|食物|饮品|生活|food|cooking|drink|lifestyle|vlog/i}
];
export function categoriesFor(item){const text=[item.title,item.description,...item.tags].join(' ');return [...new Set([...(item.category?[item.category]:[]),...inspirationCategories.filter(c=>c.pattern.test(text)).map(c=>c.id)])];}
export const refreshInterval=30*60*1000;
const bundled=JSON.parse(readFileSync(new URL('./fg-inspiration-seed.json',import.meta.url),'utf8'));
const bundledCovers=new Map(catalogSources.flatMap(source=>bundled.catalogs[source.id]?normalizeCatalog(bundled.catalogs[source.id],source):[]).filter(item=>item.cover).map(item=>[item.id,item]));
const textTemplates=bundled.text.map(e=>({id:createHash('sha256').update('curated-text\0'+e.title).digest('hex').slice(0,24),title:e.title,prompt:e.prompt,description:e.description||'',kind:'text',cover:'',media:[],playable:false,tags:e.tags||[],author:e.credit||'',sourceId:'curated-text',sourceName:e.sourceInfo.label,sourceUrl:e.sourceUrl||e.sourceInfo.repository||'',license:e.sourceInfo.license||'原创',model:'文本模板',updatedAt:''}));
const publicURL=value=>{try{const u=new URL(promptImageOriginalUrl(value)||value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:'';}catch{return '';}};
export function normalizeInspiration(items,source){
 return items.slice(0,4000).map(item=>{
  const media=item.previewMedia.map(m=>({kind:m.kind,url:publicURL(m.url)})).filter(m=>m.url);
  const prompt=String(item.prompt||'').slice(0,60000);
  return {id:createHash('sha256').update(source.id+'\0'+String(item.id)).digest('hex').slice(0,24),title:String(item.title||'').slice(0,240),prompt,description:String(item.description||'').slice(0,2000),
   kind:source.kind==='video'||media.some(m=>m.kind==='video')?'video':'image',playable:media.some(m=>m.kind==='video'),cover:publicURL(item.coverUrl)||media.find(m=>m.kind==='image')?.url||'',media,
   tags:item.tags.slice(0,16).map(t=>String(t).slice(0,80)),author:String(item.author||'').slice(0,120),sourceId:source.id,sourceName:source.name,
   sourceUrl:publicURL(item.sourceUrl)||source.homepage,model:item.imageModel||(/seedance/i.test(source.id)?'Seedance 2.0':/banana/i.test(source.id)?'Nano Banana':'GPT Image'),updatedAt:item.updatedAt||item.createdAt||''};
 }).filter(item=>item.prompt&&item.title&&item.media.length);
}
export async function readSource(source,fetcher){
 let response;
 // Only public catalog GETs are retried. Paid generation requests never enter this path.
 for(let attempt=0;attempt<2;attempt++){
  try{response=await fetcher(source.url,{redirect:'error',signal:AbortSignal.timeout(25000),headers:{accept:source.format==='markdown'?'text/plain':'application/json','user-agent':'FG Inspiration/1.0'}});}
  catch(error){
   const transient=error instanceof TypeError||error.name==='TimeoutError'||error.name==='AbortError';
   if(attempt||!transient)throw error;
   await new Promise(resolve=>setTimeout(resolve,250));continue;
  }
  if(response.ok)break;
  await response.body?.cancel();
  if(attempt||![408,429,500,502,503,504].includes(response.status))throw Error('HTTP '+response.status);
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 let size=0;const chunks=[];
 for await(const chunk of response.body){size+=chunk.length;if(size>(12<<20))throw Error('来源内容超过 12 MB');chunks.push(chunk);}
 const text=Buffer.concat(chunks).toString('utf8');
 if(source.format==='catalog'){const items=normalizeCatalog(JSON.parse(text),source);if(!items.length)throw Error('来源未解析出作品');return items;}
 const parsed=source.format==='markdown'?parseMarkdownSource(text,source):parseJsonSource(JSON.parse(text),source);
 const items=normalizeInspiration(parsed,source);if(!items.length)throw Error('来源未解析出可预览作品');return items;
}
export async function initializeInspiration(pool){
 await initializePersonalInspiration(pool);
 await pool.query(`CREATE TABLE IF NOT EXISTS fg_inspiration_sources(id text PRIMARY KEY,entries jsonb NOT NULL DEFAULT '[]',last_attempt timestamptz,last_success timestamptz,error text,updated_at timestamptz NOT NULL DEFAULT now())`);
 for(const s of inspirationSources)await pool.query('INSERT INTO fg_inspiration_sources(id) VALUES($1) ON CONFLICT DO NOTHING',[s.id]);
 // A bundled snapshot is not reported as a successful live synchronization.
 for(const source of catalogSources){const snapshot=bundled.catalogs[source.id];if(snapshot)await pool.query("UPDATE fg_inspiration_sources SET entries=$2::jsonb WHERE id=$1 AND entries='[]'::jsonb",[source.id,JSON.stringify(normalizeCatalog(snapshot,source))]);}
}
export async function refreshInspiration(pool,{force=false,fetcher=fetch}={}){
 const connection=await pool.connect();
 let locked=false;
 try{
  locked=(await connection.query("SELECT pg_try_advisory_lock(hashtext('fg-inspiration-refresh')) locked")).rows[0].locked;
  if(!locked)return false;
  for(const source of inspirationSources){
   const state=(await connection.query('SELECT last_attempt FROM fg_inspiration_sources WHERE id=$1',[source.id])).rows[0];
   if(!force&&state?.last_attempt&&Date.now()-new Date(state.last_attempt).getTime()<refreshInterval)continue;
   await connection.query('UPDATE fg_inspiration_sources SET last_attempt=now() WHERE id=$1',[source.id]);
   try{const entries=await readSource(source,fetcher);await connection.query('UPDATE fg_inspiration_sources SET entries=$2,last_success=now(),error=NULL,updated_at=now() WHERE id=$1',[source.id,JSON.stringify(entries)]);}
   catch(error){await connection.query('UPDATE fg_inspiration_sources SET error=$2 WHERE id=$1',[source.id,String(error.message||'同步失败').slice(0,240)]);}
  }
  return true;
 }finally{if(locked)await connection.query("SELECT pg_advisory_unlock(hashtext('fg-inspiration-refresh'))");connection.release();}
}
export function startInspirationSync(pool){
 const run=()=>void refreshInspiration(pool).catch(error=>console.error('[fg-inspiration]',error.code||'sync-failed'));
 run();const timer=setInterval(run,60000);timer.unref();return()=>clearInterval(timer);
}
const recommendationDay = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
export function filterInspiration(entries,params,now=new Date()){
 const kind=params.get('kind'),source=params.get('source'),category=params.get('category'),model=params.get('model'),q=(params.get('q')||'').trim().toLowerCase().slice(0,100);
 const filtered=entries.filter(e=>(!kind||e.kind===kind)&&(!source||e.sourceId===source)&&(!model||e.model===model)&&(!category||categoriesFor(e).includes(category))&&(!q||[e.title,e.prompt,e.promptZh,e.description,...e.tags,e.sourceName].join(' ').toLowerCase().includes(q)));
 if(params.get('sort')!=='newest'&&!params.get('collection')&&!q){
  const day=recommendationDay.format(now);
  return filtered.map(entry=>({entry,rank:createHash('sha256').update(day+'\0'+entry.id).digest('hex')}))
   .sort((a,b)=>a.rank.localeCompare(b.rank)||a.entry.id.localeCompare(b.entry.id))
   .map(({entry})=>entry);
 }
 return filtered.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))||a.sourceId.localeCompare(b.sourceId));
}
export function distinctInspiration(entries,favorites=[]){
 const groups=new Map();
 for(const entry of entries){
  if(entry.sourceId==='mine'){groups.set('mine:'+entry.id,entry);continue;}
  const key=entry.kind+'\0'+entry.prompt.trim().replace(/\s+/g,' '),previous=groups.get(key);
  if(!previous){groups.set(key,entry);continue;}
  const preferred=entry.sourceId.startsWith('catalog-')?entry:previous;
  const id=favorites.includes(previous.id)?previous.id:favorites.includes(entry.id)?entry.id:preferred.id;
  groups.set(key,{...preferred,id});
 }
 return [...groups.values()];
}
export async function inspirationRoute(req,res,{pool,actor,path}){
 if(!path.pathname.startsWith('/api/fg/inspiration'))return false;
 const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private,no-store'});res.end(JSON.stringify({code:status===200?0:status,data,msg:status===200?'':data?.reason||'灵感内容暂不可用'}));};
 if(!actor?.id){send(null,401);return true;}
 if(await personalInspirationRoute(req,res,{pool,actor,path,send}))return true;
 if(req.method==='POST'&&path.pathname==='/api/fg/inspiration/refresh'){
  if(!actor.reviewer){send(null,403);return true;}
  // Refreshes remain bounded by the same 30-minute server schedule.
  void refreshInspiration(pool).catch(()=>{});send({scheduled:true});return true;
 }
 if(req.method!=='GET'){send(null,405);return true;}
 const rows=(await pool.query('SELECT * FROM fg_inspiration_sources')).rows;
 // Apply source semantics to cached entries too, so a cover-only video prompt
 // remains in the video section before the next source refresh completes.
 const allEntries=rows.flatMap(r=>{
  const source=inspirationSources.find(s=>s.id===r.id);
  return r.entries.map(e=>{const fallback=!e.cover?bundledCovers.get(e.id):undefined;return {...e,...(fallback?{cover:fallback.cover,media:fallback.media}:{}),kind:source?.kind==='video'?'video':e.kind,playable:e.media.some(m=>m.kind==='video')};});
 });
 const personal=await personalInspirationState(pool,actor.id);
 allEntries.unshift(...(isPublicDemo(actor)?personal.custom:await sharedPersonalInspirations(pool)),...textTemplates);
 const entries=distinctInspiration(allEntries,personal.favorites);
 const id=path.pathname.match(/^\/api\/fg\/inspiration\/items\/([a-f0-9]{24})$/)?.[1];
 if(id){const item=entries.find(e=>e.id===id)||allEntries.find(e=>e.id===id);send(item||null,item?200:404);return true;}
 if(path.pathname==='/api/fg/inspiration/export'){send({format:'fg-inspiration',version:1,exportedAt:new Date().toISOString(),entries:personal.custom,favorites:personal.favorites});return true;}
 if(path.pathname!=='/api/fg/inspiration'){send(null,404);return true;}
 const visible=path.searchParams.get('collection')==='favorites'?entries.filter(e=>personal.favorites.includes(e.id)):path.searchParams.get('collection')==='mine'?personal.custom:entries;
 const filtered=filterInspiration(visible,path.searchParams),page=Math.max(1,Math.min(200,Number(path.searchParams.get('page'))||1)),limit=36;
 const sources=[{id:'mine',name:'团队个人灵感',count:allEntries.filter(e=>e.sourceId==='mine').length,lastSuccess:null,error:null},{id:'curated-text',name:'文本模板 · CC0 / 原创',count:textTemplates.length,lastSuccess:null,error:null},...inspirationSources.map(s=>{const state=rows.find(r=>r.id===s.id);return {id:s.id,name:s.name,homepage:s.homepage,count:state?.entries.length||0,lastSuccess:state?.last_success||null,lastAttempt:state?.last_attempt||null,error:state?.error||null};})];
 const kindEntries=entries.filter(e=>!path.searchParams.get('kind')||e.kind===path.searchParams.get('kind'));
 send({items:filtered.slice((page-1)*limit,page*limit).map(({prompt,promptZh,...item})=>item),total:filtered.length,page,pageSize:limit,
  categories:[...new Map([...inspirationCategories,...entries.filter(e=>e.category).map(e=>({id:e.category,name:e.categoryName||e.category}))].map(c=>[c.id,{id:c.id,name:c.name,count:kindEntries.filter(e=>categoriesFor(e).includes(c.id)).length}])).values()],models:[...new Set(kindEntries.map(e=>e.model))].sort(),
  counts:{image:entries.filter(e=>e.kind==='image').length,video:entries.filter(e=>e.kind==='video').length,text:entries.filter(e=>e.kind==='text').length,playableVideo:entries.filter(e=>e.kind==='video'&&e.media.some(m=>m.kind==='video')).length},sources,favorites:personal.favorites,refreshMinutes:30});return true;
}
