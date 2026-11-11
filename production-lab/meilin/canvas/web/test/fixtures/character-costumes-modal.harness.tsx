import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
const dom=new Window({url:"http://localhost/"});
const originals=new Map<string,PropertyDescriptor|undefined>();
for(const [key,value] of Object.entries({window:dom,document:dom.document,navigator:dom.navigator,HTMLElement:dom.HTMLElement,Element:dom.Element,Node:dom.Node,SVGElement:dom.SVGElement,ShadowRoot:dom.ShadowRoot,MutationObserver:dom.MutationObserver,ResizeObserver:dom.ResizeObserver,Event:dom.Event,CustomEvent:dom.CustomEvent,getComputedStyle:dom.getComputedStyle.bind(dom),IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
}
// Existing model/settings widgets have separate coverage; this exercises the
// actual character-card selection and confirmation path without model calls.
mock.module("@/components/model-picker",()=>({ModelPicker:()=>null}));
mock.module("@/components/image-settings-panel",()=>({ImageSettingsPanel:()=>null}));
mock.module("@/components/ui/product/app-modal",()=>({AppModal:({children,footer}:{children:React.ReactNode;footer:React.ReactNode})=><div>{children}{footer}</div>}));
const {act}=await import("react");
const {createRoot}=await import("react-dom/client");
const {QueryClient,QueryClientProvider}=await import("@tanstack/react-query");
const {App}=await import("antd");
const {CharacterCostumesModal}=await import("@/pages/projects/detail/character-costumes-modal");
afterAll(()=>{dom.happyDOM.abort();for(const [key,value] of originals){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
test("switching costume cards confirms the exact role/version, while keeping the same character",async()=>{
    const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false}}});
    const character={versionId:"current-version",version:7,definition:{gender:"男性"},visualStatus:"ready",voiceStatus:"ready",representations:[{id:"base",resourceId:"base-image",mediaType:"image",role:"primary"},{id:"night",resourceId:"night-image",mediaType:"image",role:"costume:night",metadata:{name:"雨夜外套",clothing:"深蓝色风衣"}}]};
    const asset={id:"actor",title:"调查员",category:"character",character} as any;
    client.setQueryData(["project","project","character-costumes","actor"],{asset,character});
    const selected:Array<[string,string]>=[];let closed=false;
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
    try{
        await act(async()=>root.render(<QueryClientProvider client={client}><App><CharacterCostumesModal projectId="project" asset={asset} onRefresh={()=>{}} onClose={()=>{closed=true;}} onSelect={async(version,role)=>{selected.push([version,role]);}}/></App></QueryClientProvider>));
        const night=Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes("雨夜外套"))!;
        await act(async()=>night.click());expect(night.getAttribute("aria-pressed")).toBe("true");expect(host.textContent).toContain("深蓝色风衣");
        const confirm=Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes("本镜头使用此造型"))!;
        await act(async()=>confirm.click());expect(selected).toEqual([["current-version","costume:night"]]);expect(closed).toBe(true);
    }finally{await act(async()=>root.unmount());host.remove();client.clear();}
});
