// Publish only media already owned by the creator of an existing story canvas.
// This backfills the explicitly shared workspaces without touching free canvases.
export async function publishExistingStoryMedia(pool){
 const rows=(await pool.query(`SELECT c.id,c.user_id,c.project_id,c.payload_json FROM canvas_projects c JOIN fg_story_projects f ON f.native_project_id=c.project_id
 UNION ALL SELECT a.id,a.user_id,l.project_id,jsonb_build_object('assetId',a.id,'asset',a.payload_json::jsonb)::text FROM assets a JOIN project_asset_links l ON l.asset_id=a.id JOIN fg_story_projects f ON f.native_project_id=l.project_id`)).rows;
 for(const row of rows){
  let doc;try{doc=JSON.parse(row.payload_json);}catch{continue;}
  const resources=new Set(),assets=new Set();
  function walk(value){
   if(typeof value==='string'){
    const id=value.startsWith('resource:')?value.slice(9):value.match(/\/api\/resources\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1];
    if(id&&/^[a-zA-Z0-9_-]{1,80}$/.test(id))resources.add(id);
   }else if(Array.isArray(value)){value.forEach(walk);}else if(value&&typeof value==='object'){
    for(const [key,child] of Object.entries(value)){if(key==='assetId'&&typeof child==='string')assets.add(child);walk(child);}
   }
  }
  walk(doc);
  await pool.query('INSERT INTO fg_resource_grants(project_id,resource_id) SELECT $1,id FROM resources WHERE user_id=$2 AND id=ANY($3::text[]) ON CONFLICT DO NOTHING',[row.project_id,row.user_id,[...resources]]);
  await pool.query('INSERT INTO fg_asset_grants(project_id,asset_id) SELECT $1,id FROM assets WHERE user_id=$2 AND id=ANY($3::text[]) ON CONFLICT DO NOTHING',[row.project_id,row.user_id,[...assets]]);
 }
}
