import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "Element", "Node", "HTMLElement", "HTMLTextAreaElement", "SVGElement", "ShadowRoot", "MutationObserver", "ResizeObserver", "getComputedStyle"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : key === "getComputedStyle" ? dom.getComputedStyle.bind(dom) : dom[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });
const data = new Map<string, string>();
mock.module("@/lib/localforage-storage", () => ({ localForageStorage: {}, localForageStorageForScope: (scope: string) => ({ getItem: async (key: string) => data.get(scope+key) || null, setItem: async (key: string, value: string) => { data.set(scope+key,value); }, removeItem: async (key: string) => { data.delete(scope+key); } }) }));
mock.module("@/components/fg-price-preview", () => ({ FGPricePreview: () => null }));
mock.module("@/components/model-picker", () => ({ ModelPicker: () => null }));
mock.module("@/components/image-size-picker", () => ({ ImageSizePicker: () => null }));
mock.module("@/components/skills/skill-runtime-picker", () => ({ SkillRuntimePicker: () => null, useSkillRuntimeCatalog: () => ({ skills: [], loading: false }) }));
mock.module("@/pages/projects/detail/shot-video-batch-modal", () => ({ ShotVideoBatchModal: () => null }));
mock.module("@/pages/projects/detail/shot-image-generation-modal", () => ({ ShotImageGenerationModal: () => null }));
mock.module("@/components/canvas/canvas-resource-mention-textarea", () => ({ CanvasResourceMentionTextarea: (props: { value: string; onChange: (text: string) => void }) => <textarea aria-label="shot-prompt" value={props.value} onChange={event => props.onChange(event.target.value)} /> }));
let resolveRewrite!: (value: { text: string }) => void;
mock.module("@/pages/projects/detail/shot-prompt-rewrite", () => ({ rewriteShotVideoPrompt: () => new Promise(resolve => { resolveRewrite = resolve; }) }));
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App } = await import("antd");
const { useUserStore } = await import("@/stores/use-user-store");
useUserStore.setState({ user: { id: "workspace-test-user" } as never });
const actualProjects = await import("@/services/api/projects");
let linkCalls = 0;
let finishLink!: () => void;
mock.module("@/services/api/projects", () => ({ ...actualProjects, linkShotAsset: () => { linkCalls++; return new Promise(resolve => { finishLink = () => resolve({}); }); } }));
const { default: Workbench } = await import("@/pages/projects/detail/workflow-production-workbench");
import type { ProjectDetail, ProjectShot, ShotRevision } from "@/services/api/projects";

afterAll(() => dom.happyDOM.abort());
test("switching shots retains edited prompts and separates notes; polling cannot invalidate a rewrite of that draft", async () => {
    const shots = ["one", "two"].map((id, position) => ({ id, unitId: "u", projectId: "p", title: `镜头0${position+1}`, description: "人物坐在桌前", position, durationMs: 15000, status: "draft", currentRevisionId: `r-${id}` } as ProjectShot));
    const revisions = shots.map(shot => ({ id: shot.currentRevisionId, shotId: shot.id, videoPrompt: `原始提示词${shot.id}`, plotDescription: shot.description, durationMs: 15000, version: 1 } as ShotRevision));
    let poll!: () => void;
    const detail = { project: { id: "p", name: "测试项目", aspectRatio: "9:16" }, units: [{ id: "u", title: "第三章", position: 0 }], assets: [], shots, shotReferences: [], shotArtifacts: [], shotRevisions: revisions, tasks: [] } as unknown as ProjectDetail;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    function Harness() {
        const [selected, select] = useState("one");
        const [version, refresh] = useState(1);
        poll = () => refresh(value => value+1);
        const changed = version > 1 ? { ...detail, shots: shots.map(shot => shot.id === "one" ? { ...shot, currentRevisionId: "remote-revision" } : shot), shotRevisions: [...revisions, { ...revisions[0], id: "remote-revision", version: 2, videoPrompt: "轮询返回的服务端旧正文" }] } : detail;
        return <Workbench activeStage="video" detail={changed} projectId="p" unitId="u" selectedShot={changed.shots.find(shot => shot.id===selected)} onSelectShot={select} onRefresh={async () => {}} onAddShot={() => {}} addingShot={false} />;
    }
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
    const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new dom.MouseEvent("click", { bubbles: true })); }); await settle(); };
    const fill = async (element: HTMLTextAreaElement, text: string) => { await act(async () => { Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype,"value")!.set!.call(element,text); element.dispatchEvent(new dom.Event("input", { bubbles: true })); }); };
    const button = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent?.includes(text))!;
    const prompt = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="shot-prompt"]')!;
    const notes = () => document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="例如：起步"]')!;
    try {
        await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><App><Harness /></App></MemoryRouter></QueryClientProvider>));
        await settle();
        expect(prompt().value).toBe("原始提示词one");
        await fill(prompt(), "我手动修改的咖啡厅提示词\n\n");
        await act(async () => poll()); await settle();
        expect(prompt().value).toBe("我手动修改的咖啡厅提示词\n\n");
        await click(button("提修改意见")); await fill(notes(), "镜头一独有的修改意见");
        await click(document.querySelector(".ant-modal-close")!);
        await click(host.querySelectorAll(".workflow-timeline-shot")[1]);
        await click(button("提修改意见")); expect(notes().value).toBe("");
        await fill(notes(), "镜头二独有的修改意见"); await click(document.querySelector(".ant-modal-close")!);
        await click(host.querySelectorAll(".workflow-timeline-shot")[0]);
        expect(prompt().value).toBe("我手动修改的咖啡厅提示词\n\n");
        await click(button("提修改意见")); expect(notes().value).toBe("镜头一独有的修改意见");
        await click(button("生成修改建议"));
        await click(document.querySelector(".ant-modal-close")!);
        await click(host.querySelectorAll(".workflow-timeline-shot")[1]);
        await click(host.querySelectorAll(".workflow-timeline-shot")[0]);
        await act(async () => poll()); await settle();
        await act(async () => resolveRewrite({ text: "按咖啡厅要求重写后的提示词" })); await settle();
        await click(button("提修改意见"));
        await click(button("检查后应用到编辑区"));
        expect(prompt().value).toBe("按咖啡厅要求重写后的提示词");
        expect(document.body.textContent).not.toContain("生成建议后正文或时长又有修改");
    } finally {
        await act(async () => root.unmount()); host.remove(); client.clear();
    }
});

test("a pending asset association is not submitted again when switching away and back", async () => {
    const shots = ["one", "two"].map((id, position) => ({ id: "binding-"+id, projectId: "binding-project", unitId: "u", title: id, position, durationMs:15000, currentRevisionId:"binding-r-"+id, description: position===0?"人物拿起帽子":"人物独自行走" } as ProjectShot));
    const detail = { project:{id:"binding-project",name:"绑定状态测试",aspectRatio:"9:16"}, units:[{id:"u",title:"第三章",position:0}], shots, assets:[{id:"hat",title:"帽子",mediaType:"image",category:"prop",status:"confirmed",primaryVersionId:"hat-v",storageKey:"resource:hat",versionCount:1,usages:[],position:0,updatedAt:"2026-10-25T00:00:00Z"}], shotReferences:[],shotArtifacts:[],tasks:[],shotRevisions:shots.map(shot=>({id:shot.currentRevisionId,shotId:shot.id,plotDescription:shot.description,videoPrompt:shot.description,durationMs:15000,version:1})) } as unknown as ProjectDetail;
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    function Harness() { const [selected,select]=useState(shots[0].id);return <Workbench activeStage="video" detail={detail} projectId="binding-project" unitId="u" selectedShot={shots.find(shot=>shot.id===selected)} onSelectShot={select} onRefresh={async()=>{}} onAddShot={()=>{}} addingShot={false} />; }
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
    const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});};
    const select=async(index:number)=>{await act(async()=>host.querySelectorAll<HTMLButtonElement>(".workflow-timeline-shot")[index].click());await settle();};
    try {
        await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter><App><Harness /></App></MemoryRouter></QueryClientProvider>));await settle();
        expect(linkCalls).toBe(1);
        await select(1);await select(0);
        expect(linkCalls).toBe(1);
        const match=[...host.querySelectorAll("button")].find(button=>button.textContent?.includes("重新匹配资产"))!;
        expect(match.classList.contains("ant-btn-loading")).toBe(true);
        await act(async()=>finishLink());await settle();
        expect(match.classList.contains("ant-btn-loading")).toBe(false);
    } finally { await act(async()=>root.unmount());host.remove();client.clear(); }
});
