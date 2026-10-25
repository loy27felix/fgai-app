import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
const dom = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "Element", "Node", "HTMLElement", "MutationObserver"] as const) Object.defineProperty(globalThis,key,{ configurable:true,value:key==="window"?dom:dom[key] });
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let observe!: () => void;
class Observer {
    constructor(callback: (entries: Array<{isIntersecting:boolean}>) => void) { observe=()=>callback([{isIntersecting:true}]); }
    observe() {} disconnect() {}
}
Object.assign(globalThis,{IntersectionObserver:Observer});
let scope="alice",captures=0,resolutions=0;
mock.module("@/lib/user-scope",()=>({ getActiveUserScope:()=>scope }));
mock.module("@/components/cached-resource-image",()=>({ CachedResourceImage:()=>null }));
mock.module("@/services/file-storage",()=>({ resolveVideoMediaUrl:async()=>{ resolutions++;return "http://media.test/video"; } }));
mock.module("@/lib/video-poster",()=>({ captureVideoPoster:async()=>{ captures++;return {poster:new Blob([new Uint8Array([1,2,3])],{type:"image/jpeg"})}; } }));
const {act}=await import("react");
const {createRoot}=await import("react-dom/client");
const {VideoMediaPreview}=await import("@/components/asset-media-preview");
afterAll(()=>dom.happyDOM.abort());
test("only a visible tile decodes; remount reuses its account-scoped thumbnail",async()=>{
    const host=document.createElement("div");document.body.append(host);
    for (const user of ["alice","alice","bob"]) {
        scope=user;const root=createRoot(host);
        await act(async()=>root.render(<VideoMediaPreview storageKey="resource:clip" alt="第三章 镜头01" />));
        expect(host.querySelector("img")).toBeNull();
        const before=captures;
        await act(async()=>{observe();await new Promise(resolve=>setTimeout(resolve,10));});
        expect(host.querySelector("img")?.alt).toBe("第三章 镜头01");
        expect(captures).toBe(before+(user==="alice"&&before>0?0:1));
        await act(async()=>root.unmount());
    }
    expect(captures).toBe(2);expect(resolutions).toBe(2);host.remove();
});
