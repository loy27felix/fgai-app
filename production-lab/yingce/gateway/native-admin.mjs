import {randomBytes,randomUUID,createHash} from 'node:crypto';
export async function withNativeAdmin(pool,work) {
  const {rows} = await pool.query("SELECT id FROM users WHERE username LIKE 'fg_%' AND role='admin' AND status='active' ORDER BY created_at LIMIT 1");
  if (rows.length !== 1) throw new Error('Verified FG admin required');
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  await pool.query("INSERT INTO auth_sessions(id,user_id,token_hash,expires_at,created_at,updated_at) VALUES($1,$2,$3,now()+interval '10 minutes',now(),now())",[id,rows[0].id,createHash('sha256').update(token).digest('hex')]);
  const headers={cookie:`open_ai_canvas_session=${id}.${token}`,origin:process.env.FG_SIX_PUBLIC_URL,'content-type':'application/json'};
  const api=async(path,method='GET',body)=>{
    const raw=body instanceof Uint8Array;
    const r=await fetch(`http://web:3000/api${path}`,{method,headers:{...headers,...(raw?{'content-type':'application/zip'}:{})},body:body===undefined?undefined:raw?body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const result=await r.json();
    if (!r.ok||result.code!==0) throw new Error(`${method} ${path}: ${String(result.msg||r.status).replace(/sk-[\w-]+/g,'[redacted]')}`);
    return result.data;
  };
  try{return await work(api,rows[0].id);}finally{await pool.query('DELETE FROM auth_sessions WHERE id=$1',[id]);}
}
