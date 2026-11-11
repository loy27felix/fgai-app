import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ProjectAsset, ShotAssetReference } from "@/services/api/projects";
import type { ShotCostumeTimeline } from "@/pages/projects/detail/shot-costume-timeline";
const dom = new Window({url:"http://localhost/"});
const originals = new Map<string,PropertyDescriptor|undefined>();
for(const [key,value] of Object.entries({window:dom,document:dom.document,navigator:dom.navigator,HTMLElement:dom.HTMLElement,Element:dom.Element,Node:dom.Node,SVGElement:dom.SVGElement,ShadowRoot:dom.ShadowRoot,MutationObserver:dom.MutationObserver,ResizeObserver:dom.ResizeObserver,Event:dom.Event,CustomEvent:dom.CustomEvent,getComputedStyle:dom.getComputedStyle.bind(dom),IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
}
mock.module("@/components/ui/product/app-modal",()=>({AppModal:({children,footer}:{children:React.ReactNode;footer:React.ReactNode})=><div>{children}{footer}</div>}));
const {act}=await import("react");
const {createRoot}=await import("react-dom/client");
const {ShotCostumeTimelineModal}=await import("@/pages/projects/detail/shot-costume-timeline-modal");
afterAll(()=>{dom.happyDOM.abort();for(const [key,value] of originals){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
test("timed wardrobe confirms two actual images; invalid overlap does not save; clearing is explicit",async()=>{
    const asset={id:"actor",title:"调查员",character:{representations:[{id:"base",resourceId:"base-image",mediaType:"image",role:"primary"},{id:"night",resourceId:"night-image",mediaType:"image",role:"costume:night",metadata:{name:"雨夜外套"}}]}} as ProjectAsset;
    const reference={id:"ref",assetVersionId:"version"} as ShotAssetReference;
    const saved:Array<ShotCostumeTimeline|undefined>=[];let closed=0;
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
    const render=async(key:string,json?:string)=>act(async()=>root.render(<ShotCostumeTimelineModal key={key} asset={asset} reference={reference} durationMs={15000} actionBeatsJson={json} onClose={()=>{closed++;}} onSave={async(plan)=>{saved.push(plan);}}/>));
    const click=async(text:string)=>act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent===text)!.click());
    try{
        await render("new");
        expect(host.querySelectorAll('input[role="spinbutton"]')).toHaveLength(4);
        expect(host.querySelector('img[alt="第2段实际服装参考图"]')?.getAttribute("src")).toContain("night-image");
        await click("保存换装时间轴");
        expect(saved[0]?.segments).toEqual([{startMs:0,endMs:7500,role:"reference",resourceId:"base-image"},{startMs:7500,endMs:15000,role:"costume:night",resourceId:"night-image"}]);
        expect(closed).toBe(1);
        const invalid={...saved[0]!,segments:saved[0]!.segments.map((segment,index)=>index?{...segment,startMs:5000}:segment)};
        await render("invalid",JSON.stringify([invalid]));
        await click("保存换装时间轴");
        expect(host.textContent).toContain("不能重叠");
        expect(saved).toHaveLength(1);
        await click("取消分段换装");expect(saved).toHaveLength(2);expect(saved[1]).toBeUndefined();
    }finally{await act(async()=>root.unmount());host.remove();}
});
