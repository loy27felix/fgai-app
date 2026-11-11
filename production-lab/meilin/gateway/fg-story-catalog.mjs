import {validateStory} from './fg-team-stories.mjs';

export async function storyCatalogRoute(req,res,{actor,path,pool,topics,body,send,api}){
 const match=/^\/api\/fg\/topics\/(\d+)$/.exec(path.pathname);
 if(!match)return false;
 if(!actor.reviewer){send(res,'仅管理员可修改或删除故事库内容',403);return true;}
 if(!['PUT','DELETE'].includes(req.method)){send(res,'故事操作不存在',405);return true;}
 const id=Number(match[1]),input=req.method==='DELETE'?{revision:path.searchParams.has('revision')?Number(path.searchParams.get('revision')):null}:await body(req),client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['fg-story:'+id]);
  const current=topics.find(t=>t.id===id);
  const override=(await client.query('SELECT * FROM fg_topic_overrides WHERE topic_id=$1 FOR UPDATE',[id])).rows[0];
  if(!current||override?.deleted_at)throw Error('故事不存在或已删除，请刷新');
  if(!Number.isInteger(input.revision)||input.revision!==(override?.revision||0)){await client.query('ROLLBACK');send(res,'故事已被其他管理员修改，请刷新',409);return true;}
  if(req.method==='DELETE'){
   if((await client.query('SELECT 1 FROM fg_story_projects WHERE topic_id=$1 AND archived_at IS NULL',[id])).rowCount){await client.query('ROLLBACK');send(res,'故事已立项，请先删除对应制作项目',409);return true;}
   const submission=(await client.query('SELECT * FROM fg_stories WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[id])).rows[0];
   await api('/fg-story-archive','POST',{id,revision:submission?.revision??input.revision,snapshot:submission?{submission,catalog:override||current,event:{action:'archived',actorId:actor.id,revision:submission.revision}}:override?.snapshot||current});
   await client.query('INSERT INTO fg_topic_overrides(topic_id,snapshot,deleted_at,updated_by) VALUES($1,$2,now(),$3) ON CONFLICT(topic_id) DO UPDATE SET deleted_at=now(),revision=fg_topic_overrides.revision+1,updated_by=excluded.updated_by,updated_at=now()',[id,JSON.stringify(override?.snapshot||current),actor.id]);
   await client.query("UPDATE fg_stories SET archived_at=now(),revision=revision+1,updated_at=now(),review_events=review_events||jsonb_build_array(jsonb_build_object('action','archived','actorId',$2::text,'at',now())) WHERE id=$1 AND archived_at IS NULL",[id,actor.id]);
  }else{
   const story=validateStory(input);
   await client.query('INSERT INTO fg_topic_overrides(topic_id,snapshot,updated_by) VALUES($1,$2,$3) ON CONFLICT(topic_id) DO UPDATE SET snapshot=excluded.snapshot,revision=fg_topic_overrides.revision+1,updated_by=excluded.updated_by,updated_at=now()',[id,JSON.stringify(story),actor.id]);
  }
  await client.query('COMMIT');send(res,{saved:true,deleted:req.method==='DELETE'});return true;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
