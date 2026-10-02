import {randomUUID,createHash} from 'node:crypto';

export function importedGroupID(value){
 const source=String(value);
 if(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(source))return source;
 const h=createHash('sha256').update('fg-platform-group:'+source).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

export function validateStory(input){
 const fields={title:120,original:500,characters:1000,plot:6000,conflict:3000,style:500,markets:500,form:100,language:200,channel:200,source_rights:1000};
 const story={};
 for(const [key,max] of Object.entries(fields)){
  const text=String(input?.[key]??'').trim();
  if(text.length>max)throw new Error('请缩短故事字段：'+key);
  story[key]=text;
 }
 for(const key of ['title','original','characters','plot','conflict','style','markets','form'])if(!story[key])throw new Error('请填写完整的故事、人物原型和制作方向');
 return story;
}
export function canReview(actor){return actor.reviewer===true;}
export function storyVisible(row,actor){return row.status==='approved'||row.submitted_by===actor.id||canReview(actor);}

const directoryRefreshed=new WeakMap();
async function refreshAccounts(pool,platform,platformCookie){
 if(Date.now()-(directoryRefreshed.get(pool)||0)<60000)return;
 const response=await fetch(new URL('/api/production-lab/admin',platform),{headers:{cookie:platformCookie},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw new Error('平台账号读取失败');
 const data=await response.json();if(!Array.isArray(data.users))throw new Error('平台账号格式无效');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const u of data.users){
   await client.query(`INSERT INTO users(id,username,display_name,role,status,password_hash,created_at,updated_at) VALUES($1,$2,$3,$4,'active','',now(),now()) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role`,[u.id,'fg_'+u.id.replaceAll('-','').slice(0,29),u.displayName,u.platformRole==='superadmin'?'admin':'user']);
   await client.query('INSERT INTO fg_accounts(user_id,email,platform_role) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,platform_role=excluded.platform_role',[u.id,u.email,u.platformRole]);
  }
  await client.query('COMMIT');directoryRefreshed.set(pool,Date.now());
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function bootstrapTeam(pool,actor,platform,platformCookie){
 if(!canReview(actor))return;
 const initialized=(await pool.query("SELECT value FROM fg_company_settings WHERE key='teamImported'" )).rows[0];
 if(initialized){await refreshAccounts(pool,platform,platformCookie);return;}
 const r=await fetch(new URL('/api/production-lab/admin',platform),{headers:{cookie:platformCookie},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!r.ok)throw new Error('小组与平台账号读取失败');
 const data=await r.json();
 if(!Array.isArray(data.users)||!Array.isArray(data.groups))throw new Error('小组与平台账号格式无效');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('fg-team-bootstrap'))");
  if((await c.query("SELECT 1 FROM fg_company_settings WHERE key='teamImported'")).rowCount){await c.query('COMMIT');return;}
  for(const g of data.groups)await c.query('INSERT INTO fg_groups(id,name,archived_at,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[importedGroupID(g.id),g.name,g.archivedAt,g.createdAt]);
  for(const u of data.users){
   await c.query(`INSERT INTO users(id,username,display_name,role,status,password_hash,created_at,updated_at) VALUES($1,$2,$3,$4,'active','',now(),now()) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role`,[u.id,'fg_'+u.id.replaceAll('-','').slice(0,29),u.displayName,u.platformRole==='superadmin'?'admin':'user']);
   await c.query('INSERT INTO fg_accounts(user_id,email,platform_role) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,platform_role=excluded.platform_role',[u.id,u.email,u.platformRole]);
   if(u.groupId&&data.groups.some(g=>g.id===u.groupId&&!g.archivedAt))await c.query('INSERT INTO fg_memberships(id,user_id,group_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[randomUUID(),u.id,importedGroupID(u.groupId)]);
  }
  // The current human explicitly requested group 3. This is a one-time move;
  // subsequent administrator changes must never be reset during a refresh.
  let g=(await c.query("SELECT id FROM fg_groups WHERE name='小组3' AND archived_at IS NULL")).rows[0];
  if(!g){g={id:randomUUID()};await c.query("INSERT INTO fg_groups(id,name) VALUES($1,'小组3')",[g.id]);}
  const requester=data.users.find(u=>u.email?.toLowerCase()===process.env.FG_GROUP3_ACCOUNT_EMAIL?.toLowerCase());
  if(requester){
   await c.query('UPDATE fg_memberships SET unassigned_at=now() WHERE user_id=$1 AND unassigned_at IS NULL',[requester.id]);
   await c.query('INSERT INTO fg_memberships(id,user_id,group_id,role) VALUES($1,$2,$3,\'manager\')',[randomUUID(),requester.id,g.id]);
  }
  await c.query("INSERT INTO fg_company_settings(key,value) VALUES('teamImported','true'::jsonb)");
  await c.query('COMMIT');
  directoryRefreshed.set(pool,Date.now());
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function teamAndStoryAPI(req,res,ctx,{body,send,topics}){
 const {path,pool,actor,platform,platformCookie}=ctx;
 const p=path.pathname;
 if(!p.startsWith('/api/fg/team')&&!p.startsWith('/api/fg/stories'))return false;
 if(p.startsWith('/api/fg/team')){
  await bootstrapTeam(pool,actor,platform,platformCookie);
  if(p==='/api/fg/team'&&req.method==='GET'){
   const groups=(await pool.query(`SELECT g.*,count(m.id)::int member_count FROM fg_groups g LEFT JOIN fg_memberships m ON m.group_id=g.id AND m.unassigned_at IS NULL WHERE g.archived_at IS NULL GROUP BY g.id ORDER BY g.created_at,g.name`)).rows;
   const users=(await pool.query(`SELECT u.id,u.display_name,a.email,a.platform_role,m.group_id,m.role group_role,g.name group_name FROM users u JOIN fg_accounts a ON a.user_id=u.id LEFT JOIN fg_memberships m ON m.user_id=u.id AND m.unassigned_at IS NULL LEFT JOIN fg_groups g ON g.id=m.group_id AND g.archived_at IS NULL ORDER BY u.display_name,u.id`)).rows;
   send(res,{groups,users,canManage:canReview(actor),currentGroup:users.find(u=>u.id===actor.id)?.group_id||null});return true;
  }
  if(!canReview(actor)){send(res,'仅超级管理员可管理制作小组',403);return true;}
  const input=await body(req);
  if(p==='/api/fg/team/groups'&&req.method==='POST'){
   const name=String(input.name||'').trim();if(!name||name.length>80)throw new Error('请填写有效小组名称');
   const id=randomUUID();await pool.query('INSERT INTO fg_groups(id,name) VALUES($1,$2)',[id,name]);send(res,{id});return true;
  }
  if(p==='/api/fg/team/groups'&&req.method==='PATCH'){
   const name=String(input.name||'').trim();if(!name||name.length>80)throw new Error('请填写有效小组名称');
   const r=await pool.query('UPDATE fg_groups SET name=$2 WHERE id=$1 AND archived_at IS NULL',[input.id,name]);if(!r.rowCount)throw new Error('小组已停用，请刷新');send(res,{saved:true});return true;
  }
  if((p==='/api/fg/team/groups'&&req.method==='DELETE')||(p==='/api/fg/team/groups/archive'&&req.method==='POST')){
   const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query('UPDATE fg_groups SET archived_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING id',[input.id]);if(!r.rowCount)throw new Error('小组已停用，请刷新');await c.query('UPDATE fg_memberships SET unassigned_at=now() WHERE group_id=$1 AND unassigned_at IS NULL',[input.id]);await c.query('COMMIT');send(res,{archived:true});}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}return true;
  }
  if(p==='/api/fg/team/member'&&req.method==='PUT'){
   const c=await pool.connect();try{
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['fg-member:'+input.userId]);
    if(!(await c.query('SELECT 1 FROM fg_accounts WHERE user_id=$1',[input.userId])).rowCount)throw new Error('请选择平台已有账号');
    if(input.groupId&&!(await c.query('SELECT 1 FROM fg_groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[input.groupId])).rowCount)throw new Error('小组已停用，请刷新');
    const current=(await c.query('SELECT group_id FROM fg_memberships WHERE user_id=$1 AND unassigned_at IS NULL',[input.userId])).rows[0]?.group_id||null;
    if(current!==(input.expectedGroupId||null)){await c.query('ROLLBACK');send(res,'其他同事已修改分组，请刷新后重试',409);return true;}
    await c.query('UPDATE fg_memberships SET unassigned_at=now() WHERE user_id=$1 AND unassigned_at IS NULL',[input.userId]);
    if(input.groupId)await c.query('INSERT INTO fg_memberships(id,user_id,group_id,role) VALUES($1,$2,$3,$4)',[randomUUID(),input.userId,input.groupId,input.role==='manager'?'manager':'member']);
    await c.query('COMMIT');send(res,{saved:true});
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}return true;
  }
 }
 if(p==='/api/fg/stories'&&req.method==='GET'){
  const rows=(await pool.query(`SELECT s.*,u.display_name submitted_name FROM fg_stories s JOIN users u ON u.id=s.submitted_by WHERE s.status='approved' OR s.submitted_by=$1 OR $2 ORDER BY s.updated_at DESC`,[actor.id,canReview(actor)])).rows;
  send(res,{stories:rows.map(r=>({...r,...r.snapshot})),canReview:canReview(actor)});return true;
 }
 if(p==='/api/fg/stories'&&req.method==='POST'){
  const input=validateStory(await body(req));
  const row=(await pool.query("INSERT INTO fg_stories(snapshot,status,submitted_by) VALUES($1,'pending',$2) RETURNING id",[JSON.stringify(input),actor.id])).rows[0];send(res,row);return true;
 }
 if(p==='/api/fg/stories'&&req.method==='PUT'){
  const input=await body(req),story=validateStory(input);
  const r=await pool.query("UPDATE fg_stories SET snapshot=$3,status='pending',review_note='',revision=revision+1,updated_at=now() WHERE id=$1 AND submitted_by=$2 AND status IN('pending','rejected') AND revision=$4 RETURNING id",[input.id,actor.id,JSON.stringify(story),input.revision]);
  if(!r.rowCount){send(res,'故事已被修改或已通过审核，请刷新',409);return true;}send(res,{saved:true});return true;
 }
 if(p==='/api/fg/stories/review'&&req.method==='POST'){
  if(!canReview(actor)){send(res,'仅超级管理员可审核故事',403);return true;}
  const input=await body(req);if(!['approved','rejected'].includes(input.status))throw new Error('请选择审核结果');
  const note=String(input.note||'').trim();if(note.length>1000||input.status==='rejected'&&!note)throw new Error('请填写退回原因');
  const r=await pool.query("UPDATE fg_stories SET status=$2,reviewed_by=$3,review_note=$4,revision=revision+1,updated_at=now() WHERE id=$1 AND status='pending' AND revision=$5 RETURNING id",[input.id,input.status,actor.id,note,input.revision]);
  if(!r.rowCount){send(res,'故事已被审核或修改，请刷新',409);return true;}send(res,{saved:true});return true;
 }
 send(res,'FG 接口不存在',404);return true;
}

export async function approvedTopics(pool,seed){
 const submitted=(await pool.query("SELECT id,snapshot FROM fg_stories WHERE status='approved' ORDER BY id")).rows.map(r=>({...r.snapshot,id:r.id}));
 return [...seed,...submitted];
}
