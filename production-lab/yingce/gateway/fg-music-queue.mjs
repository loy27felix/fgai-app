import {createHash,randomUUID} from 'node:crypto';
import {musicStatus,downloadCompanyMusic} from './fg-music-provider.mjs';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export function musicBrief(raw){
 const b={title:raw.title||'',model:raw.model||'auto',mode:raw.mode||'custom',voice:raw.voice||'song',styles:raw.styles||'',lyrics:raw.lyrics||'',description:raw.description||''};
 if(Object.values(b).some(v=>typeof v!=='string')||b.title.length>100||b.styles.length>1000||b.lyrics.length>5000||b.description.length>3000||!['custom','inspiration'].includes(b.mode)||!['song','instrumental'].includes(b.voice)||!/^[a-zA-Z0-9.-]{1,80}$/.test(b.model))throw Error('音乐内容或模型无效');
 if(b.mode==='custom'?(!b.styles.trim()||(b.voice==='song'&&!b.lyrics.trim())):!b.description.trim())throw Error('请填写音乐风格和歌词，或填写自动创作描述');
 if(b.voice==='instrumental')b.lyrics='';
 return b;
}
export async function initializeMusicQueue(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS fg_music_jobs(id uuid PRIMARY KEY,owner_id varchar(36) NOT NULL REFERENCES users(id),operation_id uuid NOT NULL,input_hash varchar(64) NOT NULL,brief jsonb NOT NULL,status varchar(20) NOT NULL DEFAULT 'queued',operator_id varchar(36) REFERENCES users(id),clip_id uuid UNIQUE,resource_id varchar(36),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,operation_id));`);
}
export function publicMusicJob(row){return {id:row.id,ownerName:row.owner_name,brief:row.brief,status:row.status,resourceId:row.resource_id,clipId:row.clip_id,createdAt:row.created_at};}
async function body(req){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>32768)throw Error('音乐内容过长');chunks.push(c);}return JSON.parse(Buffer.concat(chunks));}
export async function musicQueueRoute(req,res,{pool,actor,path,ownerAPI,download=downloadCompanyMusic}){
 if(!path.pathname.startsWith('/api/fg/music/jobs'))return false;
 const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({code:status===200?0:status,data:status===200?data:null,msg:status===200?'':data.message}));};
 try{
  if(req.method==='GET'&&path.pathname==='/api/fg/music/jobs'){
   const rows=(await pool.query(`SELECT j.*,u.display_name owner_name FROM fg_music_jobs j JOIN users u ON u.id=j.owner_id WHERE ($2::boolean OR j.owner_id=$1) ORDER BY CASE WHEN status='succeeded' THEN 1 ELSE 0 END,created_at DESC LIMIT 60`,[actor.id,actor.reviewer===true])).rows;
   send({canManage:actor.reviewer===true,jobs:rows.map(publicMusicJob)});return true;
  }
  if(req.method==='POST'&&path.pathname==='/api/fg/music/jobs'){
   const input=await body(req);if(!uuid.test(input.operationId||''))throw Error('缺少音乐操作标识');
   const brief=musicBrief(input),hash=createHash('sha256').update(JSON.stringify(brief)).digest('hex');
   const existing=(await pool.query('SELECT * FROM fg_music_jobs WHERE owner_id=$1 AND operation_id=$2',[actor.id,input.operationId])).rows[0];
   if(existing){if(existing.input_hash!==hash)throw Error('同一操作不能替换歌词或风格');send(publicMusicJob(existing));return true;}
   const status=await musicStatus();if(!status.configured)throw Error('公司 Suno 账号尚未连接');
   if(brief.model!=='auto'&&!status.models?.some(m=>m.id===brief.model))throw Error('音乐模型暂不可用，请刷新公司模型列表');
   const row=(await pool.query('INSERT INTO fg_music_jobs(id,owner_id,operation_id,input_hash,brief) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,operation_id) DO UPDATE SET operation_id=EXCLUDED.operation_id RETURNING *',[randomUUID(),actor.id,input.operationId,hash,JSON.stringify(brief)])).rows[0];
   if(row.input_hash!==hash)throw Error('同一操作不能替换歌词或风格');send(publicMusicJob(row));return true;
  }
  const match=/^\/api\/fg\/music\/jobs\/([0-9a-f-]{36})\/(start|complete)$/.exec(path.pathname);
  if(!match||req.method!=='POST'){send({message:'音乐操作不存在'},404);return true;}
  if(!actor.reviewer){send({message:'只有管理员可处理公司音乐队列'},403);return true;}
  const job=(await pool.query('SELECT * FROM fg_music_jobs WHERE id=$1',[match[1]])).rows[0];if(!job)throw Error('音乐任务不存在');
  if(job.status==='succeeded'){send(publicMusicJob(job));return true;}
  if(match[2]==='start'){
   const updated=(await pool.query("UPDATE fg_music_jobs SET status='processing',operator_id=$2,updated_at=now() WHERE id=$1 AND (status='queued' OR (operator_id=$2 AND (status='processing' OR (status='importing' AND updated_at < now()-interval '3 minutes')))) RETURNING *",[job.id,actor.id])).rows[0];
   if(!updated)throw Error('已有其他管理员处理，请勿重复生成');send(publicMusicJob(updated));return true;
  }
  const input=await body(req);if(!uuid.test(input.clipId||''))throw Error('请填写 Suno 已完成作品的 ID');
  if(job.operator_id!==actor.id||job.status!=='processing')throw Error('请先领取任务，并在公司账号中完成制作');
  if(job.clip_id&&job.clip_id!==input.clipId)throw Error('此任务已绑定原作品，不能替换或重新生成');
  const locked=(await pool.query("UPDATE fg_music_jobs SET clip_id=$2,status='importing',updated_at=now() WHERE id=$1 AND status='processing' RETURNING *",[job.id,input.clipId])).rows[0];
  if(!locked)throw Error('作品正在归档，请稍后刷新');
  try{
   const audio=await download(input.clipId),form=new FormData();form.set('kind','audio');form.set('file',new Blob([audio],{type:'audio/mpeg'}),(job.brief.title||'FG-Suno')+'.mp3');
   const {resource}=await ownerAPI(job.owner_id,'/resources','POST',form,{'x-idempotency-key':'fg-suno-'+job.id});
   const saved=(await pool.query("UPDATE fg_music_jobs SET status='succeeded',resource_id=$2,updated_at=now() WHERE id=$1 RETURNING *",[job.id,resource.id])).rows[0];send(publicMusicJob(saved));
  }catch(error){await pool.query("UPDATE fg_music_jobs SET status='processing',clip_id=CASE WHEN $2::boolean THEN NULL ELSE clip_id END,updated_at=now() WHERE id=$1 AND status='importing'",[job.id,error.code==='SUNO_CLIP_NOT_OWNED']);throw error;}
 }catch(error){send({message:error.code==='23505'?'该作品已被另一任务使用，请核对原作品':error.message||'音乐操作未完成'},400);}return true;
}
