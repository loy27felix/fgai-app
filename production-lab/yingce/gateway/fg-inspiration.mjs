import {createHash} from 'node:crypto';
import {DEFAULT_PROMPT_SOURCES,parseJsonSource,parseMarkdownSource,promptImageOriginalUrl} from './fg-inspiration-parser.mjs';

export const inspirationSources=DEFAULT_PROMPT_SOURCES;
export const refreshInterval=30*60*1000;
const publicURL=value=>{try{const u=new URL(promptImageOriginalUrl(value)||value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:'';}catch{return '';}};
export function normalizeInspiration(items,source){
 return items.slice(0,4000).map(item=>{
  const media=item.previewMedia.map(m=>({kind:m.kind,url:publicURL(m.url)})).filter(m=>m.url);
  const prompt=String(item.prompt||'').slice(0,60000);
  return {id:createHash('sha256').update(source.id+'\0'+String(item.id)).digest('hex').slice(0,24),title:String(item.title||'').slice(0,240),prompt,description:String(item.description||'').slice(0,2000),
   kind:media.some(m=>m.kind==='video')?'video':'image',cover:publicURL(item.coverUrl)||media.find(m=>m.kind==='image')?.url||'',media,
   tags:item.tags.slice(0,16).map(t=>String(t).slice(0,80)),author:String(item.author||'').slice(0,120),sourceId:source.id,sourceName:source.name,
   sourceUrl:publicURL(item.sourceUrl)||source.homepage,model:item.imageModel||(/seedance/i.test(source.id)?'Seedance 2.0':/banana/i.test(source.id)?'Nano Banana':'GPT Image'),updatedAt:item.updatedAt||item.createdAt||''};
 }).filter(item=>item.prompt&&item.title&&item.media.length);
}
async function readSource(source,fetcher){
 const response=await fetcher(source.url,{redirect:'error',signal:AbortSignal.timeout(25000),headers:{accept:source.format==='markdown'?'text/plain':'application/json','user-agent':'FG Inspiration/1.0'}});
 if(!response.ok)throw Error('HTTP '+response.status);
 let size=0;const chunks=[];
 for await(const chunk of response.body){size+=chunk.length;if(size>(12<<20))throw Error('来源内容超过 12 MB');chunks.push(chunk);}
 const text=Buffer.concat(chunks).toString('utf8');
 const parsed=source.format==='markdown'?parseMarkdownSource(text,source):parseJsonSource(JSON.parse(text),source);
 const items=normalizeInspiration(parsed,source);if(!items.length)throw Error('来源未解析出可预览作品');return items;
}
export async function initializeInspiration(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS fg_inspiration_sources(id text PRIMARY KEY,entries jsonb NOT NULL DEFAULT '[]',last_attempt timestamptz,last_success timestamptz,error text,updated_at timestamptz NOT NULL DEFAULT now())`);
 for(const s of inspirationSources)await pool.query('INSERT INTO fg_inspiration_sources(id) VALUES($1) ON CONFLICT DO NOTHING',[s.id]);
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
export function filterInspiration(entries,params){
 const kind=params.get('kind'),source=params.get('source'),q=(params.get('q')||'').trim().toLowerCase().slice(0,100);
 const filtered=entries.filter(e=>(!kind||e.kind===kind)&&(!source||e.sourceId===source)&&(!q||[e.title,e.prompt,e.description,...e.tags,e.sourceName].join(' ').toLowerCase().includes(q)));
 return filtered.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))||a.sourceId.localeCompare(b.sourceId));
}
export async function inspirationRoute(req,res,{pool,actor,path}){
 if(!path.pathname.startsWith('/api/fg/inspiration'))return false;
 const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private,no-store'});res.end(JSON.stringify({code:status===200?0:status,data,msg:status===200?'':'灵感内容暂不可用'}));};
 if(req.method==='POST'&&path.pathname==='/api/fg/inspiration/refresh'){
  if(!actor.reviewer){send(null,403);return true;}
  // Refreshes remain bounded by the same 30-minute server schedule.
  void refreshInspiration(pool).catch(()=>{});send({scheduled:true});return true;
 }
 if(req.method!=='GET'){send(null,405);return true;}
 const rows=(await pool.query('SELECT * FROM fg_inspiration_sources')).rows;
 const entries=rows.flatMap(r=>r.entries);
 const id=path.pathname.match(/^\/api\/fg\/inspiration\/items\/([a-f0-9]{24})$/)?.[1];
 if(id){const item=entries.find(e=>e.id===id);send(item||null,item?200:404);return true;}
 if(path.pathname!=='/api/fg/inspiration'){send(null,404);return true;}
 const filtered=filterInspiration(entries,path.searchParams),page=Math.max(1,Math.min(200,Number(path.searchParams.get('page'))||1)),limit=36;
 const sources=inspirationSources.map(s=>{const state=rows.find(r=>r.id===s.id);return {id:s.id,name:s.name,homepage:s.homepage,count:state?.entries.length||0,lastSuccess:state?.last_success||null,lastAttempt:state?.last_attempt||null,error:state?.error||null};});
 send({items:filtered.slice((page-1)*limit,page*limit).map(({prompt,...item})=>item),total:filtered.length,page,pageSize:limit,
  counts:{image:entries.filter(e=>e.kind==='image').length,video:entries.filter(e=>e.kind==='video').length},sources,refreshMinutes:30});return true;
}
