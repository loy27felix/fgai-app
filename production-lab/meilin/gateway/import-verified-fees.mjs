import fs from 'node:fs/promises';
import pg from 'pg';
import {withNativeAdmin} from './native-admin.mjs';
import {importFeeCsv} from './fg-fee-import.mjs';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
try{
 const file=process.argv[2];
 if(!file)throw new Error('Provide a verified WeToken consumption CSV path');
 const csv=await fs.readFile(file,'utf8');
 await withNativeAdmin(pool,async(api,actorId)=>{
  await api('/admin/channels?limit=1');
  console.log(JSON.stringify(await importFeeCsv(pool,actorId,csv)));
  console.log(JSON.stringify(await importFeeCsv(pool,actorId,csv)));
 });
}finally{await pool.end();}
