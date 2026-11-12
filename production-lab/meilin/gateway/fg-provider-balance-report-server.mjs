import http from 'node:http';
import pg from 'pg';
import {balanceReportRoute} from './fg-provider-balance-report.mjs';

if(!/^[A-Za-z0-9_-]{32,256}$/.test(process.env.FG_BALANCE_REPORT_TOKEN||''))throw Error('BALANCE_REPORT_TOKEN_REQUIRED');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:10000,query_timeout:10000,options:'-c default_transaction_read_only=on'});
pool.on('error',()=>console.error('BALANCE_REPORT_DATABASE_UNAVAILABLE'));
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/health/live'&&req.method==='GET'){
   res.writeHead(200,{'content-type':'text/plain','cache-control':'no-store'});res.end('ok');return;
  }
  const path=new URL(req.url,'http://balance-report');
  if(await balanceReportRoute(req,res,{pool,path}))return;
  res.writeHead(404,{'cache-control':'no-store'});res.end();
 }catch{
  console.error('BALANCE_REPORT_UNAVAILABLE');
  if(res.headersSent){res.destroy();return;}
  res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'BALANCE_REPORT_UNAVAILABLE'}));
 }
});
server.requestTimeout=15000;
server.headersTimeout=10000;
server.listen(3011,'0.0.0.0');
