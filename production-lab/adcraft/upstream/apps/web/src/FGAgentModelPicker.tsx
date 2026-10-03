import {useEffect,useState} from 'react';
import {api} from './api/client';
import type {ProviderModelSummaryV1} from './api/providerRegistry';
import {selectableModelOptions} from './api/providerModelPolicy';
import {CanvasModelPicker} from './features/agent-canvas/workbench/CanvasModelPicker';
import {fgWorkspace} from './fg-scope';

/** The native per-workspace agent default is persisted by AdCraft, not the browser. */
export function FGAgentModelPicker({disabled}:{disabled:boolean}){
 const [models,setModels]=useState<ProviderModelSummaryV1[]>([]),[selected,setSelected]=useState<string|null>(null),[pending,setPending]=useState(true),[error,setError]=useState<string|null>(null),[price,setPrice]=useState('');
 useEffect(()=>{let stopped=false;
  void Promise.all([api.listProviderModels({node_type:'text',include_unavailable:true}),api.getModelDefaults()]).then(([catalog,defaults])=>{if(!stopped){setModels(selectableModelOptions(catalog.items));setSelected(defaults.defaults.agent??null);}}).catch(e=>{if(!stopped)setError(e instanceof Error?e.message:'模型读取失败');}).finally(()=>{if(!stopped)setPending(false);});
  return()=>{stopped=true;};
 },[]);
 useEffect(()=>{if(!selected)return;const controller=new AbortController();setPrice('');
  void fetch('/api/fg/advertising/'+fgWorkspace+'/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'text',model:selected.replace(/^volcengine_ark:/,'')}),signal:controller.signal}).then(r=>r.json()).then(d=>{if(d.code===0)setPrice(d.data.lines.join('；'));}).catch(()=>{});
  return()=>controller.abort();
 },[selected]);
 return <div className="fg-agent-model"><CanvasModelPicker models={models} loading={pending} error={error} selectionMode="explicit" modelRef={selected} modelSummary={null} disabled={disabled||pending} appearance="monochrome" showOptionDetails={false} showStatusDetails={false} defaultModelRef={selected} onChange={async(mode,modelRef)=>{
  if(mode!=='explicit'||!modelRef||pending)return;setPending(true);setError(null);
  try{const saved=await api.patchModelDefaults({defaults:{agent:modelRef}});setSelected(saved.defaults.agent??modelRef);}catch(e){setError(e instanceof Error?e.message:'模型保存失败');}finally{setPending(false);}
 }}/>{price?<small>{price}</small>:null}{error?<small role="alert">{error}</small>:null}</div>;
}
