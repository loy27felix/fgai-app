// Delete only the isolated native advertising directory after recoverable trash
// expires. Native FG billing, request history and shared resource GC stay intact.
export async function cleanupArchivedAdvertising(pool,request=fetch){
  const candidates=(await pool.query("SELECT id FROM fg_adcraft_workspaces WHERE archived_at < now()-interval '30 days' AND purged_at IS NULL ORDER BY archived_at LIMIT 20")).rows;
  let purged=0;
  for(const {id} of candidates){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const workspace=(await client.query("SELECT * FROM fg_adcraft_workspaces WHERE id=$1 AND archived_at < now()-interval '30 days' AND purged_at IS NULL FOR UPDATE",[id])).rows[0];
      if(!workspace){await client.query('ROLLBACK');continue;}
      const active=(await client.query("SELECT count(*) n FROM tasks WHERE project_id=$1 AND status NOT IN ('succeeded','failed','cancelled')",[workspace.native_project_id])).rows[0];
      if(Number(active.n)){await client.query('ROLLBACK');continue;}
      const response=await request('http://adcraft-api:8000/internal/fg/cleanup/'+id,{method:'POST',headers:{'x-fg-internal':process.env.FG_ADCRAFT_SECRET},signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw Error('Advertising cleanup deferred');
      const result=await response.json();if(result.purged!==true)throw Error('Advertising cleanup not confirmed');
      await client.query('UPDATE fg_adcraft_workspaces SET purged_at=now() WHERE id=$1',[id]);
      await client.query('COMMIT');purged++;
    }catch{
      await client.query('ROLLBACK');
      // Retry next hour. Never substitute a failed NAS delete with database success.
    }finally{client.release();}
  }
  return purged;
}

export function startAdvertisingRetention(pool){
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{await cleanupArchivedAdvertising(pool);}catch{console.error('Advertising retention deferred');}finally{running=false;}};
  setTimeout(tick,60000).unref();
  setInterval(tick,3600000).unref();
}
