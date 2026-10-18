import { test, expect, afterAll } from "bun:test";
import { Window } from "happy-dom";
const win = new Window({url:"http://localhost/fg-six/meilin?project=demo"});
for (const name of ["window","document","navigator","location","history","HTMLElement","SVGElement","Element","Node","ShadowRoot","Event","MouseEvent","MutationObserver","ResizeObserver"]) {
    Object.defineProperty(globalThis,name,{value:name==="window"?win:(win as any)[name],configurable:true});
}
globalThis.getComputedStyle=win.getComputedStyle.bind(win) as any;
globalThis.matchMedia=win.matchMedia.bind(win) as any;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import("react-dom/client");
const {act}=await import("react");
const {api}=await import("../src/api");
const {default:StudioRoot}=await import("../src/StudioApp");
const questions=[
 {id:"style",question:"影像基底？",options:["真人实拍质感","3D CG"]},
 {id:"delivery",question:"交付方式？",options:["Markdown文稿","两者都要"]},
 {id:"splice",question:"如何衔接？",options:["末帧承接","换机位硬切"]},
];
const d:any={id:"demo",titleZh:"确认创作方向",updatedAt:new Date().toISOString(),permissions:{canEdit:true},messages:[{id:"agent-1",role:"agent",text:"请确认以下三项",at:new Date().toISOString()}],settings:{textModel:"gpt-6.1-sol",videoParams:{},imageParams:{}},assets:{items:[]},production:[],studio:{chain:"prism",mode:"production",stage:"concept",locks:{},questions,artifacts:[],runs:[]}};
const calls:any[]=[];
let poll:()=>Promise<void>;
let failNext=false;
const originalInterval=globalThis.setInterval;
globalThis.setInterval=((fn:any,delay:number,...args:any[])=>{if(delay===6000)poll=fn;return originalInterval(fn,delay,...args);}) as any;
api.config=async()=>({chains:[{id:"prism",name:"超级棱镜",stages:[{id:"concept",name:"故事方案"}]}],models:[],actor:{id:"me",name:"我"}} as any);
api.list=async()=>[{id:"demo",titleZh:d.titleZh,updatedAt:d.updatedAt}] as any;
api.get=async()=>structuredClone(d);
api.studio=async(_id,type,payload)=>{calls.push({type,payload});if(failNext){failNext=false;throw Error("测试中的临时提交失败");}return {project:{...structuredClone(d),studio:{...d.studio,questions:[]}}};};
const container=document.createElement("div");document.body.append(container);
const root=createRoot(container);
afterAll(()=>{act(()=>root.unmount());globalThis.setInterval=originalInterval;win.happyDOM.abort();});
const click=async(el:Element)=>act(async()=>{(el as HTMLElement).click();await Promise.resolve();});

test("three independent selections submit together once, without replacing the composer",async()=>{
 await act(async()=>{root.render(<StudioRoot/>);await new Promise(r=>setTimeout(r,30));});
 const confirm=()=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes("确认并发送"));
 expect(confirm()).toBeDefined();
 expect(confirm()!.disabled).toBe(true);
 for(const answer of ["真人实拍质感","Markdown文稿","换机位硬切"]){
  const option=Array.from(container.querySelectorAll("label")).find(b=>b.textContent?.trim()===answer);
  expect(option).toBeDefined();await click(option!);
 }
 expect(container.querySelectorAll('input[type="radio"]:checked')).toHaveLength(3);
 await act(async()=>{await poll();});
 expect(container.querySelectorAll('input[type="radio"]:checked')).toHaveLength(3);
 await click(Array.from(container.querySelectorAll("label")).find(b=>b.textContent?.trim()==="3D CG")!);
 expect(container.querySelectorAll('input[type="radio"]:checked')).toHaveLength(3);
 expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
 expect(calls).toHaveLength(0);
 expect(confirm()!.disabled).toBe(false);
 await click(confirm()!);
 expect(calls).toHaveLength(1);
 for(const answer of ["3D CG","Markdown文稿","换机位硬切"])expect(calls[0].payload.text).toContain(answer);
 expect(calls[0].payload.text).not.toContain("我的选择：真人实拍质感");
});

test("failed confirmation retains all choices and duplicate clicks cannot submit twice",async()=>{
 await act(async()=>{await poll();});
 for(const answer of ["真人实拍质感","Markdown文稿","换机位硬切"])
  await click(Array.from(container.querySelectorAll("label")).find(b=>b.textContent?.trim()===answer)!);
 const confirm=()=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes("确认并发送"))!;
 const before=calls.length;failNext=true;
 await act(async()=>{confirm().click();confirm().click();await Promise.resolve();});
 expect(calls.length-before).toBe(1);
 expect(container.querySelectorAll('input[type="radio"]:checked')).toHaveLength(3);
 expect(confirm().disabled).toBe(false);
 await click(confirm());
 expect(calls.length-before).toBe(2);
 for(const answer of ["真人实拍质感","Markdown文稿","换机位硬切"])expect(calls.at(-1).payload.text).toContain(answer);
});
