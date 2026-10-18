import {readFile} from 'node:fs/promises';
import {context} from './fg-context.mjs';
let pool;
export async function database(){
 if(!pool){if(!process.env.DATABASE_URL)throw Error('美林持久化数据库未配置');const {default:pg}=await import('pg');pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});}
 return pool;
}
export async function initialize(connection){if(connection)pool=connection;const db=await database();await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));}
const auth=()=>{const c=context();if(!c.actor?.id)throw Error('请先登录 FG');return c.actor.id;};
export async function get(id,write=false){
 const db=await database(),actor=auth();
 const row=(await db.query(`SELECT d.document,d.revision,d.owner_id,m.role FROM fg_meilin_dramas d LEFT JOIN fg_meilin_members m ON m.drama_id=d.id AND m.user_id=$2 WHERE d.id=$1 AND d.deleted_at IS NULL AND (d.owner_id=$2 OR m.role IS NOT NULL)`,[id,actor])).rows[0];
 if(!row)return null;
 if(write&&row.owner_id!==actor&&row.role!=='editor')throw Error('没有此剧的编辑权限');
 return {...row.document,_revision:row.revision,_ownerId:row.owner_id,_role:row.owner_id===actor?'owner':row.role};
}
export async function save(d){
 const db=await database(),actor=auth(),{_revision,_ownerId,_role,...doc}=d;doc.updatedAt=new Date().toISOString();
 const client=await db.connect();let revision;
 try{await client.query('BEGIN');
 if(_revision===undefined){
  await client.query('INSERT INTO fg_meilin_dramas(id,owner_id,document) VALUES($1,$2,$3)',[d.id,actor,doc]);revision=1;
 }else{
  const out=await client.query(`UPDATE fg_meilin_dramas SET document=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$4 AND deleted_at IS NULL AND (owner_id=$2 OR EXISTS(SELECT 1 FROM fg_meilin_members WHERE drama_id=$1 AND user_id=$2 AND role='editor')) RETURNING revision`,[d.id,actor,doc,_revision]);
  if(!out.rowCount)throw Error('项目已被其他操作更新，请刷新后重试');revision=out.rows[0].revision;
 }
 await client.query('INSERT INTO fg_meilin_events(drama_id,actor_id,action,detail) VALUES($1,$2,$3,$4)',[d.id,actor,_revision===undefined?'create':context().action||'update',{revision,operationId:context().operationId||null}]);
 await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 d._revision=revision;if(_revision===undefined)d._ownerId=actor;
 d.updatedAt=doc.updatedAt;return d;
}
export async function list(){const db=await database();return (await db.query(`SELECT d.document,d.owner_id FROM fg_meilin_dramas d WHERE d.deleted_at IS NULL AND (owner_id=$1 OR EXISTS(SELECT 1 FROM fg_meilin_members WHERE drama_id=d.id AND user_id=$1)) ORDER BY updated_at DESC`,[auth()])).rows.map(x=>({...x.document,canDelete:x.owner_id===auth()}));}
export async function remove(id){const db=await database(),actor=auth(),client=await db.connect();try{
 await client.query('BEGIN');const r=await client.query('UPDATE fg_meilin_dramas SET deleted_at=now() WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL RETURNING id',[id,actor]);if(!r.rowCount)throw Error('只有所有者可以删除剧目');
 await client.query('INSERT INTO fg_meilin_events(drama_id,actor_id,action,detail) VALUES($1,$2,$3,$4)',[id,actor,'delete',{}]);await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
export async function members(id,body){const db=await database();const d=await get(id);if(!d||d._ownerId!==auth())throw Error('只有所有者可以管理分享');
 if(body){let userId=body.userId;if(body.email){if(typeof body.email!=='string'||body.email.length>254)throw Error('成员邮箱格式无效');userId=(await db.query("SELECT a.user_id FROM fg_accounts a JOIN users u ON u.id=a.user_id WHERE lower(a.email)=$1 AND u.status='active'",[body.email.trim().toLowerCase()])).rows[0]?.user_id;if(!userId)throw Error('未找到有效 FG 成员');}
 if(body.role==='remove')await db.query('DELETE FROM fg_meilin_members WHERE drama_id=$1 AND user_id=$2',[id,userId]);else{if(!['viewer','editor'].includes(body.role))throw Error('分享角色无效');await db.query('INSERT INTO fg_meilin_members(drama_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(drama_id,user_id) DO UPDATE SET role=excluded.role',[id,userId,body.role]);}await db.query('INSERT INTO fg_meilin_events(drama_id,actor_id,action,detail) VALUES($1,$2,$3,$4)',[id,auth(),'share',{userId,role:body.role}]);}
 return (await db.query('SELECT user_id,role FROM fg_meilin_members WHERE drama_id=$1',[id])).rows;
}
export async function fileAccess(file){const db=await database();return (await db.query(`SELECT 1 FROM fg_meilin_dramas d WHERE d.deleted_at IS NULL AND (owner_id=$1 OR EXISTS(SELECT 1 FROM fg_meilin_members WHERE drama_id=d.id AND user_id=$1)) AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(d.document->'uploads','[]')) u WHERE u->>'url'=$2) LIMIT 1`,[auth(),'/files/'+file])).rowCount===1;}
export async function active(){const db=await database();return (await db.query(`SELECT id,owner_id FROM fg_meilin_dramas WHERE deleted_at IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(document->'production','[]')) p WHERE p->>'status' IN ('confirmed','submitted','queued','running','archiving','recovering'))`)).rows;}
export async function studioActive(){const db=await database();return (await db.query(`SELECT id,owner_id FROM fg_meilin_dramas WHERE deleted_at IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(document->'studio'->'runs','[]')) r WHERE r->>'status' IN ('queued','running'))`)).rows;}
