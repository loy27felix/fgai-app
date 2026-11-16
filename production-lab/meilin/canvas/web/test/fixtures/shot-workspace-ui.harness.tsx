import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { DIRECTOR_PROMPT_SECTIONS } from "@/lib/short-drama-production";

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
let resolveRewrite!: (value: { text: string }) => void;
let rewriteFacts: Record<string, unknown>;
mock.module("@/pages/projects/detail/shot-prompt-rewrite", () => ({
    rewriteShotVideoPrompt: ({ facts }: { facts: Record<string, unknown> }) => new Promise(resolve => {
        rewriteFacts = facts;
        resolveRewrite = resolve;
    }),
}));
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App } = await import("antd");
await import("@/i18n");
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
    const revisions = shots.map(shot => ({ id: shot.currentRevisionId, shotId: shot.id, videoPrompt: `原始提示词${shot.id}${shot.id === "two" ? "\n镜头二参考：@[asset:neighbor-only]" : ""}`, plotDescription: shot.description, durationMs: 15000, version: 1 } as ShotRevision));
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
    const prompt = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label^="视频提示词"]')!;
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
        expect(rewriteFacts.next).toMatchObject({ videoPrompt: "原始提示词two" });
        await click(document.querySelector(".ant-modal-close")!);
        await click(host.querySelectorAll(".workflow-timeline-shot")[1]);
        await click(host.querySelectorAll(".workflow-timeline-shot")[0]);
        await act(async () => poll()); await settle();
        const rewrite = DIRECTOR_PROMPT_SECTIONS.map(section => section === "声音设计"
            ? "【15秒分镜／动作时间轴】\n0—15秒｜室内\n人物动作：角色坐在桌前。\n镜头运动：平稳向前。\n背景：咖啡厅灯光稳定。\n【声音设计】\n室内底噪。"
            : `【${section}】\n${section === "参考图绑定" ? "过期参考：@[asset:neighbor-only]\n保留原有空间关系。" : "按咖啡厅要求重写后的提示词"}`).join("\n\n");
        await act(async () => resolveRewrite({ text: rewrite })); await settle();
        await click(button("提修改意见"));
        await click(button("检查后应用到编辑区"));
        expect(prompt().value).toBe(rewrite.replace("过期参考：@[asset:neighbor-only]\n", ""));
        expect(document.body.textContent).not.toContain("生成建议后正文或时长又有修改");
    } finally {
        await act(async () => root.unmount()); host.remove(); client.clear();
    }
});

test("shot editors keep the gallery layout and insert references in both editors", async () => {
    const shot = { id: "mention-shot", projectId: "mention-project", unitId: "u", title: "镜头01", position: 0, durationMs: 15000, currentRevisionId: "mention-revision" } as ProjectShot;
    const assets = ["艾拉男装", "伊森", "录音室"].map((title, position) => ({
        id: `asset-${position}`, title, position, category: "material", mediaType: "image",
        storageKey: `resource:image-${position}`, primaryVersionId: `version-${position}`, status: "confirmed", versionCount: 1, usages: [],
    }));
    const detail = {
        project: { id: shot.projectId, name: "引用测试", aspectRatio: "9:16" },
        units: [{ id: shot.unitId, title: "测试章节", position: 0 }],
        shots: [shot], assets, shotArtifacts: [], tasks: [],
        shotReferences: assets.map(asset => ({ id: asset.id, shotId: shot.id, assetVersionId: asset.primaryVersionId, role: "reference", status: "linked", asset })),
        shotRevisions: [{ id: shot.currentRevisionId, shotId: shot.id, videoPrompt: "角色参考：", plotDescription: "", durationMs: 15000, version: 1 }],
    } as unknown as ProjectDetail;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(
            <QueryClientProvider client={client}><MemoryRouter><App>
                <Workbench activeStage="video" detail={detail} projectId={shot.projectId} unitId={shot.unitId}
                    selectedShot={shot} onSelectShot={() => {}} onRefresh={async () => {}} onAddShot={() => {}} addingShot={false} />
            </App></MemoryRouter></QueryClientProvider>,
        ));
        for (const expanded of [false, true]) {
            if (expanded) {
                await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("展开编辑完整提示词"))!.click());
            }
            const scope = expanded ? document.querySelector<HTMLElement>(".ant-modal-container")! : host;
            scope.getBoundingClientRect = () => new dom.DOMRect(0, 0, 1000, 760) as unknown as DOMRect;
            const editor = scope.querySelector<HTMLElement>('[role="textbox"][aria-label^="视频提示词"]')!;
            await act(async () => {
                editor.focus();
                const text = document.createTextNode(" @");
                editor.append(text);
                const range = document.createRange();
                range.setStart(text, text.length);
                range.collapse(true);
                const selection = window.getSelection()!;
                selection.removeAllRanges();
                selection.addRange(range);
                editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true }));
            });
            const menu = document.querySelector<HTMLElement>("[data-canvas-resource-mention-menu]")!;
            expect(menu.classList.contains("is-gallery")).toBe(true);
            const cards = menu.querySelectorAll<HTMLButtonElement>(".canvas-resource-mention-card");
            expect([...cards].map(card => card.querySelector(".canvas-resource-mention-card-label")?.textContent)).toEqual(assets.map(asset => asset.title));
            const previousCount = editor.querySelectorAll("[data-mention-token]").length;
            await act(async () => cards[expanded ? 1 : 0].click());
            expect(editor.querySelectorAll("[data-mention-token]")).toHaveLength(previousCount + 1);
            expect(document.querySelector("[data-canvas-resource-mention-menu]")).toBeNull();
        }
    } finally {
        await act(async () => root.unmount());
        host.remove();
        client.clear();
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
