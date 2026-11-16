import {timingSafeEqual} from 'node:crypto';
import {providerBalance} from './fg-provider-balance.mjs';

const reportPath='/api/fg/finance/balance-report';
const timeFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const moneyFormat=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6});

export function balanceReport(value,date=new Date()){
 const available=value.available===true&&value.currency==='USD'&&Number.isFinite(value.balance);
 const stale=available&&value.stale===true;
 const balance=available?value.balance:null;
 const updatedAt=available?value.updatedAt:null;
 const lines=['WeToken 每日账户余额',`报告时间：${timeFormat.format(date)}（北京时间）`];
 if(available){
  lines.push(`${stale?'上次有效余额':'账户剩余余额'}：${moneyFormat.format(balance)} USD`);
  if(updatedAt)lines.push(`余额更新时间：${timeFormat.format(new Date(updatedAt))}（北京时间）`);
  if(stale)lines.push('本次余额刷新失败，以上为上次有效值，不代表当前实时余额。');
 }else lines.push('本次余额获取失败，剩余余额未知；请检查项目中的 WeToken 账单授权。');
 return {provider:'WeToken',currency:'USD',available,balance,updatedAt,stale,reportedAt:date.toISOString(),message:lines.join('\n')};
}

export async function balanceReportRoute(req,res,{pool,path},{token=process.env.FG_BALANCE_REPORT_TOKEN,readBalance=providerBalance}={}){
 if(path.pathname!==reportPath)return false;
 const send=(status,data,headers={})=>{
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
  res.end(JSON.stringify(data));
 };
 // A dedicated read-only token must never reuse a platform or provider credential.
 // 独立只读令牌不能复用平台登录凭据或供应商凭据。
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(token)){
  send(404,{error:'BALANCE_REPORT_DISABLED'});return true;
 }
 const given=Buffer.from(String(req.headers.authorization||''));
 const expected=Buffer.from('Bearer '+token);
 if(given.length!==expected.length||!timingSafeEqual(given,expected)){
  send(401,{error:'BALANCE_REPORT_UNAUTHORIZED'},{'www-authenticate':'Bearer'});return true;
 }
 if(req.method!=='GET'){
  send(405,{error:'METHOD_NOT_ALLOWED'},{allow:'GET'});return true;
 }
 const value=await readBalance(pool);
 send(200,balanceReport(value));return true;
}
