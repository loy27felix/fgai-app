import {mock} from 'bun:test';
import {Window} from 'happy-dom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {strict as assert} from 'node:assert';
const window=new Window({url:'http://localhost/create'});
for(const name of ['window','document','navigator','HTMLElement','SVGElement','Element','Node','ShadowRoot','MutationObserver','ResizeObserver','getComputedStyle']) Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?window:(window as any)[name]});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const antd=await import('antd');
mock.module('antd',()=>({...antd,Select:({value,options,onChange,...props}:any)=><select aria-label={props['aria-label']} value={value} onChange={event=>onChange(event.target.value)}>{options.map((option:any)=><option key={option.value} value={option.value}>{option.label}</option>)}</select>}));
mock.module('@/components/ui/product/app-modal',()=>({AppModal:({children}:any)=><div>{children}</div>}));
mock.module('@/components/asset-media-preview',()=>({AssetMediaPreview:()=>null}));
const requests:any[]=[];
const records=[['a','A','开场'],['b','B','终局'],['none','','未归属']].map(([id,canvasId,title])=>({id,title,kind:'image',category:'material',status:'confirmed',tags:[],metadata:{canvasId},data:{storageKey:'resource:'+id},createdAt:'2026-10-21',updatedAt:'2026-10-21'}));
mock.module('@/services/user-data-sync',()=>({
 loadAssetLibraryPage:async(options:any)=>{requests.push(options);const assets=records.filter(row=>options.noCanvas?!row.metadata.canvasId:options.canvasId?row.metadata.canvasId===options.canvasId:true);return {assets,total:assets.length,categoryCounts:{all:assets.length,material:assets.length},kindCounts:{image:assets.length},folderCounts:{},page:1,pageSize:40}},
 deleteAssetsWithRemoteSync:async()=>{},saveRemoteUserDataNow:async()=>{},localSavedRemotePendingMessage:()=>''
}));
mock.module('@/services/api/user-data',()=>({listRemoteCanvasProjects:async()=>({projects:[{id:'A',title:'美杜莎'},{id:'B',title:'人工智能短剧'},{id:'empty',title:'空画布'}]})}));
const {useUserStore}=await import('../../src/stores/use-user-store');useUserStore.setState({hydrated:true,user:{id:'picker-test'} as any});
const {AssetLibraryPickerModal}=await import('../../src/components/assets/asset-library-picker-modal');
const {QueryClient,QueryClientProvider}=await import('@tanstack/react-query');
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
let confirmed:any;
await act(async()=>{root.render(<antd.App><QueryClientProvider client={client}><AssetLibraryPickerModal open remoteLibrary canvasFilter acceptRemoteItems items={[]} categoryLabels={{all:'全部素材',material:'素材'}} onClose={()=>{}} onConfirm={(ids,picked)=>{confirmed={ids,picked}}}/></QueryClientProvider></antd.App>)});
const settle=async()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,50))});await settle();
const select=host.querySelector('select[aria-label="按画布筛选素材"]') as unknown as HTMLSelectElement;assert(select);
async function choose(value:string){await act(async()=>{select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}))});await settle()}
await choose('canvas:A');assert.equal(requests.at(-1).canvasId,'A');
assert(host.querySelector('button[title="开场"]'));assert(!host.querySelector('button[title="终局"]'));
await act(async()=>{(host.querySelector('button[title="开场"]') as unknown as HTMLButtonElement).click()});
await choose('canvas:B');await act(async()=>{(host.querySelector('button[title="终局"]') as unknown as HTMLButtonElement).click()});
await choose('canvas:empty');assert(!host.querySelector('.asset-picker-card-action'),'empty canvas must not fall back to unrelated cached assets');
await choose('unassigned');assert.equal(requests.at(-1).noCanvas,true);assert(host.querySelector('button[title="未归属"]'));
await act(async()=>{const confirm=[...host.querySelectorAll('button')].find(button=>button.textContent?.includes('使用已选素材'));assert(confirm);confirm.click()});
assert.deepEqual(confirmed.ids.sort(),['a','b']);assert.deepEqual(confirmed.picked.map((row:any)=>row.id).sort(),['a','b']);
await act(async()=>root.unmount());client.clear();await window.happyDOM.close();
console.log(JSON.stringify({serverCanvasFilter:true,emptyCanvasStaysEmpty:true,unassigned:true,crossCanvasSelection:true}));
