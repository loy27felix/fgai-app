// Manual and scheduled deletion use the same row lock as restore. Physical NAS
// deletion must succeed before the database records a completed purge.
export async function purgeArchivedAdvertising(pool,id,{actor,expiredOnly=false,request=fetch}={}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const expiry=expiredOnly?" AND archived_at < now()-interval '30 days'":'';
    const workspace=(await client.query('SELECT * FROM fg_adcraft_workspaces WHERE id=$1'+expiry+' FOR UPDATE',[id])).rows[0];
    if(!workspace){if(expiredOnly){await client.query('ROLLBACK');return false;}throw Error('广告项目不存在');}
    if(actor&&workspace.owner_id!==actor.id)throw Error('仅所有者可以彻底删除项目');
    if(!workspace.archived_at)throw Error('请先将广告项目移入回收站');
    if(workspace.purged_at){await client.query('COMMIT');return true;}
    const active=(await client.query("SELECT count(*) n FROM tasks WHERE project_id=$1 AND status NOT IN ('succeeded','failed','cancelled')",[workspace.native_project_id])).rows[0];
    if(Number(active.n))throw Error('请先结束项目中正在运行的任务');
    const response=await request('http://adcraft-api:8000/internal/fg/cleanup/'+id,{method:'POST',headers:{'x-fg-internal':process.env.FG_ADCRAFT_SECRET},signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Error('NAS 清理暂未完成，请稍后重试；项目仍保留在回收站');
    const result=await response.json();if(result.purged!==true)throw Error('NAS 清理尚未确认，请稍后重试');
    await client.query('UPDATE fg_adcraft_workspaces SET purged_at=now() WHERE id=$1',[id]);
    await client.query('COMMIT');return true;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function cleanupArchivedAdvertising(pool,request=fetch){
  const candidates=(await pool.query("SELECT id FROM fg_adcraft_workspaces WHERE archived_at < now()-interval '30 days' AND purged_at IS NULL ORDER BY archived_at LIMIT 20")).rows;
  let purged=0;
  for(const {id} of candidates){
    try{
      if(await purgeArchivedAdvertising(pool,id,{expiredOnly:true,request}))purged++;
    }catch{
      // Retry next hour. Never substitute a failed NAS delete with database success.
    }
  }
  return purged;
}

export function startAdvertisingRetention(pool){
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{await cleanupArchivedAdvertising(pool);}catch{console.error('Advertising retention deferred');}finally{running=false;}};
  setTimeout(tick,60000).unref();
  setInterval(tick,3600000).unref();
}
