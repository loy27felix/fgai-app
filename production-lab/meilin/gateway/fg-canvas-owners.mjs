export async function canvasOwnersRoute(req,res,{pool,actor,path}){
 if(path.pathname!=='/api/fg/canvas/owners')return false;
 const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private,no-store'});res.end(JSON.stringify({code:status===200?0:status,data,msg:status===200?'':'仅管理员可查看用户画布目录'}));};
 if(!actor?.reviewer){send(null,403);return true;}if(req.method!=='GET'){send(null,405);return true;}
 const rows=(await pool.query("SELECT u.id,u.username,COALESCE(NULLIF(u.display_name,''),u.username) name,count(c.id)::int canvas_count FROM users u JOIN fg_accounts a ON a.user_id=u.id LEFT JOIN canvas_projects c ON c.user_id=u.id AND c.deleted_at IS NULL AND (c.project_id='' OR c.project_id IS NULL) WHERE a.platform_role IN ('user','member') AND u.status='active' GROUP BY u.id,u.username,u.display_name ORDER BY name,u.id")).rows;
 send({owners:rows.map(row=>({id:row.id,name:row.name,username:row.username,canvasCount:row.canvas_count}))});return true;
}
