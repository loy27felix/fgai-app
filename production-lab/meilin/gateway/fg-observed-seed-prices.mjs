// Infer a provisional rate only where the provider's public catalog is missing.
// A matched receipt establishes that single charge, not every future parameter.
export function extendObservedSeedPrices(snapshot, rows) {
 const rules=snapshot.pricing_rules?.rules;
 if(!Array.isArray(rules)||!(snapshot.discount>0))return snapshot;
 const groups=new Map();
 for(const row of rows){
  let body;try{body=JSON.parse(row.request_body);}catch{continue;}
  const resolution=String(body.resolution||'').toLowerCase(),scenario=body.content?.some(x=>x.type==='video_url')?'with_video_input':'without_video_input';
  const tokens=Number(row.output_tokens),usd=Number(row.usd);
  if(!row.usage_available||!(tokens>0)||!(usd>0)||!resolution||rules.some(r=>r.scenario===scenario&&String(r.resolution).toLowerCase().split('/').includes(resolution)))continue;
  const candidate=Number((usd/tokens/snapshot.discount*1e6).toFixed(1));
  const expected=Math.ceil(tokens*candidate*snapshot.discount-1e-8)/1e6;
  if(candidate<=0||Math.abs(expected-usd)>1e-8)continue;
  const key=resolution+':'+scenario,group=groups.get(key)||[];
  group.push({resolution,scenario,price:candidate,referenceId:row.reference_id});groups.set(key,group);
 }
 for(const group of groups.values()){
  if(group.some(x=>x.price!==group[0].price))continue;
  rules.push({...group[0],priceOrigin:'matched_receipt_inference',receipts:group.map(x=>x.referenceId),samples:group.length});
 }
 return snapshot;
}
