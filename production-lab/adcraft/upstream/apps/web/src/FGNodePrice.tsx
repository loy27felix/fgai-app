import {useEffect,useState} from 'react';
import {fgWorkspace} from './fg-scope';
import type {AgentCanvasWorkflowV2,CanvasNodeV2} from './types-v2';

export function FGNodePrice({workflow,node,modelRef,parameters}:{workflow:AgentCanvasWorkflowV2;node:CanvasNodeV2;modelRef:string|null;parameters:Record<string,unknown>}){
 const [price,setPrice]=useState('');
 const refs={image:0,video:0,audio:0};
 for(const binding of workflow.bindings.filter(b=>b.target_node_id===node.node_id&&b.enabled)){
  const source=binding.source;
  const assetId=source.kind==='image_asset'?source.source_asset_id:workflow.nodes.find(n=>n.node_id===source.source_node_id)?.output_asset_id;
  const asset=workflow.assets.find(a=>a.asset_id===assetId);
  if(asset&&asset.media_type in refs)refs[asset.media_type as keyof typeof refs]++;
 }
 const request=JSON.stringify({mode:node.node_type==='script'?'text':node.node_type,model:modelRef?.replace(/^volcengine_ark:/,''),options:parameters,images:refs.image,videos:refs.video,audios:refs.audio});
 useEffect(()=>{
  if(!fgWorkspace||!modelRef||!['text','script','image','video'].includes(node.node_type))return;
  const abort=new AbortController();setPrice('');
  const timer=setTimeout(()=>{void fetch('/api/fg/advertising/'+fgWorkspace+'/quote',{method:'POST',headers:{'content-type':'application/json'},body:request,signal:abort.signal}).then(r=>r.json()).then(d=>{
   if(d.code!==0)throw Error(d.msg);
   const q=d.data;
   setPrice(q.estimatedCny!==null?'≈¥'+Number(q.estimatedCny).toLocaleString('zh-CN',{maximumFractionDigits:4})+(q.estimateKind==='partial'||q.estimateKind==='lower_bound'?'起':''):q.lines.join('；')||'价格待核验');
  }).catch(()=>{if(!abort.signal.aborted)setPrice('价格暂不可用');});},200);
  return()=>{clearTimeout(timer);abort.abort();};
 },[request,modelRef,node.node_type]);
 return fgWorkspace&&price?<div className="fg-node-price">{price}</div>:null;
}
