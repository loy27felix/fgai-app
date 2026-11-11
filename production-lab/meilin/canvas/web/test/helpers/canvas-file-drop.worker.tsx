import { mock } from 'bun:test';
import { strict as assert } from 'node:assert';
import { Window } from 'happy-dom';
import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const window = new Window({url:'http://localhost/canvas/drop-test'});
for (const name of ['window','document','navigator','HTMLElement','HTMLMediaElement','SVGElement','Element','Node','ShadowRoot','MutationObserver','ResizeObserver','DOMParser','Event','CustomEvent','getComputedStyle']) Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?window:(window as any)[name]});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:window.requestAnimationFrame.bind(window),cancelAnimationFrame:window.cancelAnimationFrame.bind(window)});
window.matchMedia = (() => ({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}})) as any;
globalThis.Image = class { src='';naturalWidth=1280;naturalHeight=720;async decode(){} } as any;
const nativeCreate = document.createElement.bind(document);
document.createElement = ((tag:string,...args:any[]) => {
    const element = nativeCreate(tag,...args);
    if (tag === 'video') Object.defineProperties(element, {
        videoWidth:{value:1280},videoHeight:{value:720},load:{value:()=>{}},
        src:{set(){queueMicrotask(()=>element.dispatchEvent(new window.Event('loadedmetadata')));}},
    });
    return element;
}) as any;
URL.createObjectURL=()=> 'blob:canvas-drop-test';URL.revokeObjectURL=()=>{};

const memoryStorage=()=>{const values=new Map();return {getItem:async(key:string)=>values.get(key)??null,setItem:async(key:string,value:unknown)=>{values.set(key,value);return value;},removeItem:async(key:string)=>{values.delete(key);},keys:async()=>[...values.keys()],iterate:async()=>{},ready:async()=>{},setDriver:async()=>{}};};
mock.module('localforage',()=>({default:{...memoryStorage(),config:()=>{},createInstance:memoryStorage,INDEXEDDB:'memory'}}));

const uploads:{name:string,type:string}[]=[];
const storage=await import('../../src/services/file-storage');
mock.module('@/services/file-storage',()=>({...storage,uploadMediaFile:async(file:File)=>{
    uploads.push({name:file.name,type:file.type});
    return {url:'https://example.com/'+file.name,storageKey:'resource:video',width:1280,height:720,durationMs:5000,mimeType:file.type};
}}));
const images=await import('../../src/services/image-storage');
mock.module('@/services/image-storage',()=>({...images,uploadImage:async(file:File)=>{
    uploads.push({name:file.name,type:file.type});
    return {url:'https://example.com/'+file.name,storageKey:'resource:image',width:1280,height:720,mimeType:file.type};
}}));
const sync=await import('../../src/services/project-asset-sync');
mock.module('@/services/project-asset-sync',()=>({...sync,ensureCanvasNodeAsset:async()=>({assetId:'test-asset'})}));
const {App}=await import('antd');
const {QueryClient,QueryClientProvider}=await import('@tanstack/react-query');
const {CanvasViewport}=await import('../../src/components/canvas/canvas-viewport');
const {useCanvasUpload}=await import('../../src/pages/canvas/use-canvas-upload');
const host=document.createElement('div');document.body.append(host);
const root=createRoot(host);const noop=()=>{};let childDrops=0;
function Harness(){
    const [nodes,setNodes]=useState<any[]>([]);const nodesRef=useRef(nodes);nodesRef.current=nodes;
    const upload=useCanvasUpload({canvasId:'drop-test',nodesRef,selectedNodeIdsRef:useRef(new Set<string>()),getCanvasCenter:()=>({x:400,y:300}),screenToCanvas:(x,y)=>({x,y}),setNodes,setSelectedNodeIds:noop,setSelectedConnectionId:noop,setContextMenu:noop,setDialogNodeId:noop});
    return <><output data-drop-active>{String(upload.fileDropActive)}</output><output data-node-count>{nodes.length}</output>
        <CanvasViewport containerRef={useRef<HTMLDivElement>(null)} viewport={{x:0,y:0,k:1}} onViewportChange={noop} onFileDragEnter={upload.handleFileDragEnter} onFileDragLeave={upload.handleFileDragLeave} onFileDragOver={upload.handleFileDragOver} onDrop={upload.handleDrop}>
            <div data-drop-child data-canvas-batch-table onDragEnter={e=>e.stopPropagation()} onDragOver={e=>e.stopPropagation()} onDrop={e=>{e.stopPropagation();childDrops++;}}>node child</div>
        </CanvasViewport></>;
}
await act(async()=>root.render(<QueryClientProvider client={new QueryClient()}><App><Harness/></App></QueryClientProvider>));
async function dispatch(type:string,files:File[],internal=false){
    const target=host.querySelector('[data-drop-child]');assert(target);
    const event=new window.Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{clientX:{value:900},clientY:{value:800},dataTransfer:{value:{types:internal?['application/x-batch-row']:['Files'],files:type==='drop'?files:[],items:files.map(file=>({kind:'file',getAsFile:()=>type==='drop'?file:null})),getData:()=>'',dropEffect:'none'}}});
    await act(async()=>{target.dispatchEvent(event);await new Promise(resolve=>setTimeout(resolve,0));});
    return event;
}
for(const [name,type] of [['photo.png',''],['clip.mp4','application/octet-stream']]){
    const file=new File(['test'],name,{type});
    // A dragover without dragenter reproduces lost entry events at iframe/child boundaries.
    const over=await dispatch('dragover',[file]);assert(over.defaultPrevented);
    assert.equal(host.querySelector('[data-drop-active]')?.textContent,'true','dragover must recover the release hint');
    await dispatch('drop',[file]);
    assert.equal(host.querySelector('[data-drop-active]')?.textContent,'false');
}
assert.deepEqual(uploads,[{name:'photo.png',type:'image/png'},{name:'clip.mp4',type:'video/mp4'}]);
assert.equal(host.querySelector('[data-node-count]')?.textContent,'2');
assert.equal(childDrops,0,'external files cannot be swallowed or imported twice by a node');
await dispatch('drop',[],true);assert.equal(childDrops,1,'internal table drags stay with the table');
await act(async()=>root.unmount());await window.happyDOM.close();
console.log(JSON.stringify({externalImageAndVideoDrop:true,dragoverHintRecovery:true,childCapture:true,internalDragPreserved:true,paidCalls:0}));
