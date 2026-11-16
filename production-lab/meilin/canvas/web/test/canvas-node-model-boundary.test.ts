import { expect, test } from "bun:test";
import { migrateCanvasNodeModel } from "../src/lib/canvas/migrate-canvas-node-model";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { fgStaticAssetURL } from "../src/lib/fg-entry-url";

test("formatted text boundary retains FG specialized nodes, history content and timeline", () => {
    const node = (id: string, type: CanvasNodeType): CanvasNodeData => ({id,type,title:id,x:0,y:0,width:200,height:100,metadata:{content:"# 剧本",custom:"retained"}});
    const document = {nodes:[node("md",CanvasNodeType.Markdown),node("html",CanvasNodeType.Html),node("svg",CanvasNodeType.Svg)],connections:[],timeline:{clips:[{id:"audio"}]},remoteContentHash:"legacy"};
    const next = migrateCanvasNodeModel(document);
    expect(next.nodes[0].type).toBe(CanvasNodeType.Text);
    expect(next.nodes[0].metadata?.textFormat).toBe("markdown");
    expect(next.nodes[0].metadata?.content).toBe("# 剧本");
    expect(next.nodes[1]).toBe(document.nodes[1]);
    expect(next.nodes[2]).toBe(document.nodes[2]);
    expect(next.timeline).toBe(document.timeline);
    expect(next.remoteContentHash).toBeUndefined();
    expect(migrateCanvasNodeModel(next)).toBe(next);
});

test("built-in avatar assets resolve under FG deployment prefix", () => {
    expect(fgStaticAssetURL("/doll/avatar.json","/fg-six/")).toBe("/fg-six/doll/avatar.json");
    expect(fgStaticAssetURL("/doll/idle.mp4","/fg-six/")).toBe("/fg-six/doll/idle.mp4");
});
