import {createHash,randomUUID} from 'node:crypto';
import {safeInspirationURL} from './fg-inspiration-catalog.mjs';

export function normalizePersonalEntry(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('灵感格式无效');
 const title=String(input.title||'').trim(),prompt=String(input.prompt||'').trim(),kind=input.kind||input.mode;
 if(!title||title.length>240||!prompt||prompt.length>60000||!['text','image','video'].includes(kind))throw Error('请填写标题、提示词和有效的创作类型');
 const cover=safeInspirationURL(input.cover||input.image||'');
 if((input.cover||input.image)&&!cover)throw Error('封面须为有效的 HTTPS 图片地址');
 return {id:/^[a-f0-9]{24}$/.test(input.id)?input.id:createHash('sha256').update(randomUUID()).digest('hex').slice(0,24),title,prompt,kind,cover,media:cover?[{kind:'image',url:cover}]:[],playable:false,
  description:String(input.description||'').slice(0,2000),tags:Array.isArray(input.tags)?input.tags.slice(0,24).map(t=>String(t).slice(0,80)):[],
  category:String(input.category||'').slice(0,100),categoryName:String(input.categoryName||input.category||'').slice(0,100),promptZh:String(input.promptZh||'').slice(0,60000),
  author:String(input.author||input.credit||'').slice(0,120),sourceId:'mine',sourceName:String(input.sourceName||'我的灵感').slice(0,120),sourceUrl:safeInspirationURL(input.sourceUrl||''),license:String(input.license||'').slice(0,120),model:String(input.model||'自建灵感').slice(0,120),updatedAt:new Date().toISOString()};
}
export async function initializePersonalInspiration(pool){
 await pool.query("CREATE TABLE IF NOT EXISTS fg_inspiration_personal(user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,custom jsonb NOT NULL DEFAULT '[]',favorites jsonb NOT NULL DEFAULT '[]',updated_at timestamptz NOT NULL DEFAULT now())");
}
export async function personalInspirationState(pool,userId){
 const row=(await pool.query('SELECT custom,favorites FROM fg_inspiration_personal WHERE user_id=$1',[userId])).rows[0];
 return {custom:row?.custom||[],favorites:row?.favorites||[]};
}
export async function sharedPersonalInspirations(pool){
 const rows=(await pool.query("SELECT p.user_id,p.custom,u.display_name,u.username FROM fg_inspiration_personal p JOIN users u ON u.id=p.user_id WHERE NOT EXISTS(SELECT 1 FROM fg_accounts a WHERE a.user_id=p.user_id AND a.email='test@beva.com')")).rows;
 return rows.flatMap(row=>row.custom.map(entry=>({...entry,ownerId:row.user_id,creatorName:row.display_name||row.username,sourceName:'个人灵感 · '+(row.display_name||row.username)})));
}
async function readBody(req){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>4*1024*1024)throw Error('导入内容最多 4 MB');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
export async function personalInspirationRoute(req,res,{pool,actor,path,send}){
 if(!['/api/fg/inspiration/personal','/api/fg/inspiration/favorites','/api/fg/inspiration/custom','/api/fg/inspiration/import'].includes(path.pathname))return false;
 if(!actor?.id){send(null,401);return true;}
 if(req.method==='GET'&&path.pathname.endsWith('/personal')){send(await personalInspirationState(pool,actor.id));return true;}
 if(req.method!=='POST'){send(null,405);return true;}
 let client;
 try{
  const body=await readBody(req);client=await pool.connect();await client.query('BEGIN');
  await client.query("INSERT INTO fg_inspiration_personal(user_id) VALUES($1) ON CONFLICT DO NOTHING",[actor.id]);
  const state=(await client.query('SELECT custom,favorites FROM fg_inspiration_personal WHERE user_id=$1 FOR UPDATE',[actor.id])).rows[0];
  if(path.pathname.endsWith('/favorites')){
   if(!/^[a-f0-9]{24}$/.test(body.id)||typeof body.favorite!=='boolean')throw Error('收藏格式无效');
   state.favorites=state.favorites.filter(x=>x!==body.id);if(body.favorite)state.favorites.push(body.id);
   if(state.favorites.length>10000)throw Error('收藏最多 10000 条');
  }else{
   const entries=path.pathname.endsWith('/import')?(body.entries||body.custom):[body];
   const importing=path.pathname.endsWith('/import');
   if(!Array.isArray(entries)||entries.length>500||(!entries.length&&!(importing&&Array.isArray(body.favorites))))throw Error('每次最多导入 500 条灵感');
   if(importing&&body.favorites!==undefined){
    if(!Array.isArray(body.favorites)||body.favorites.length>10000||body.favorites.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id)))throw Error('收藏格式无效');
   }
   const next=new Map(state.custom.map(e=>[e.id,e]));
   const importedIds=new Map();
   for(const input of entries){const entry=normalizePersonalEntry(input&&typeof input==='object'?{...input,id:next.has(input.id)?input.id:undefined}:input);next.set(entry.id,entry);if(input?.id)importedIds.set(input.id,entry.id);}
   if(importing&&body.favorites){state.favorites=[...new Set([...state.favorites,...body.favorites.map(id=>importedIds.get(id)||id)])];if(state.favorites.length>10000)throw Error('收藏最多 10000 条');}
   if(next.size>500)throw Error('个人灵感最多 500 条');state.custom=[...next.values()];
  }
  await client.query('UPDATE fg_inspiration_personal SET custom=$2::jsonb,favorites=$3::jsonb,updated_at=now() WHERE user_id=$1',[actor.id,JSON.stringify(state.custom),JSON.stringify(state.favorites)]);
  await client.query('COMMIT');send({saved:true,...state});
 }catch(e){if(client)await client.query('ROLLBACK');send({reason:e.code?'保存暂时失败，请重试':e.message},e.code?503:400);}
 finally{client?.release();}
 return true;
}
