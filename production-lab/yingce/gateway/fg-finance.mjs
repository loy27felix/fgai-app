// Normalized provider CSV. No time/model guesses and no recharge rows.
export function parseFeeCsv(input) {
  if(typeof input!=='string'||input.length>5_000_000)throw new Error('费用单大小无效');
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(quoted){if(c==='"'&&input[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;continue;}
    if(c==='"'){quoted=true;continue;}
    if(c===','){row.push(cell);cell='';continue;}
    if(c==='\r'||c==='\n'){if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';continue;}
    cell+=c;
  }
  if(quoted)throw new Error('费用单引号未闭合');
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  const keys=rows.shift()?.map(x=>x.replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[\s_\-()[\]]/g,''));
  if(!keys?.includes('referenceid')||!keys.some(x=>['actualamountusd','actualamount','cost'].includes(x)))throw new Error('请上传 WeToken 官方费用流水 CSV（Reference ID / Actual Amount USD 或 Cost）');
  if(keys.includes('type')!==keys.includes('status'))throw new Error('费用单缺少类型或状态');
  const entries=new Map();
  for(const cells of rows){
    const r=Object.fromEntries(keys.map((k,i)=>[k,(cells[i]||'').trim()]));
    const model=r.modelname||r['模型名称']||'';
    if(keys.includes('type')&&(!['consume','消费'].includes(r.type.toLowerCase())||!['success','成功'].includes(r.status.toLowerCase())))continue;
    if(!model)continue;
    const referenceId=r.referenceid;
    const raw=(r.actualamountusd||r.actualamount||r.cost||'').replace(/[$,\s]/g,'');
    if(!/^[-+]?\d+(\.\d{1,10})?$/.test(raw)||!referenceId||referenceId.length>160||model.length>120)throw new Error('费用单消费行金额或 Reference ID 无效');
    const usd=Math.abs(Number(raw));
    const tm=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(r.time||'');
    if(!tm)throw new Error('费用单时间格式无效（使用 WeToken 官方导出）');
    const [year,month,day,hour,minute,second]=tm.slice(1).map(Number);
    const utc=Date.UTC(year,month-1,day,hour,minute,second),check=new Date(utc);
    if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day||check.getUTCHours()!==hour||check.getUTCMinutes()!==minute||check.getUTCSeconds()!==second)throw new Error('费用单包含无效日期');
    const occurredAt=new Date(utc-8*3600_000).toISOString();
    const existing=entries.get(referenceId);
    if(existing&&(existing.usd!==usd||existing.model!==model||existing.occurredAt!==occurredAt))throw new Error('同一 Reference ID 存在冲突金额');
    entries.set(referenceId,{referenceId,model,usd,occurredAt});
  }
  if(!entries.size)throw new Error('费用单没有可核销的模型消费记录');
  return [...entries.values()];
}

export function exactFeeOwner(fee,logs){
  // WeToken async video receipts explicitly use TASK ids even when the create
  // response also has a different REQ id. Neither may be inferred from time.
  const matches=logs.filter(l=>l.billable&&l.model===fee.model&&(l.fg_fee_reference_id===fee.referenceId||(l.capability==='video'&&l.provider_request_id===fee.referenceId)));
  return matches.length===1?matches[0]:null;
}
