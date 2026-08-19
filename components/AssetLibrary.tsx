"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Asset, BibleFields } from "@/lib/types";
import { slugType } from "@/lib/types";
import { createAsset, deleteAsset, updateAsset, setLockRef } from "@/app/projects/[id]/assets/actions";
import { createClient, localMediaUrl } from "@/lib/local/client";
import { IMG_MODELS, RATIOS, sizeFor } from "@/lib/imageModels";
import { generateImage } from '@/lib/ai/image-client';
import StudioShell from "@/components/studio/StudioShell";
import AiPanel from "@/components/studio/AiPanel";
import { Icon, Hov, EditArea } from "@/components/studio/ui";

const publicUrl = (p?: string | null) => (p ? localMediaUrl("project-assets", p) : null);
const thumbUrl = (a: Asset) => a.external_url || publicUrl(a.storage_path) || publicUrl(a.poster_path);
const TABS = ["人物", "场景", "道具", "其他"] as const;
const TAB_ICON: Record<string, string[]> = {
  人物: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4 21a8 8 0 0 1 16 0"],
  场景: ["M3 20h18", "M5 20V9l7-5 7 5v11", "M9 20v-6h6v6"],
  道具: ["M12 2 4 7v10l8 5 8-5V7z", "M12 22V12M4 7l8 5 8-5"],
  其他: ["M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"],
};
const PH: Record<string, string> = {
  人物: "radial-gradient(130% 130% at 50% 22%,#26406e,#0a1226 72%)",
  场景: "radial-gradient(130% 130% at 50% 22%,#1d3f3c,#08130f 72%)",
  道具: "radial-gradient(130% 130% at 50% 22%,#3a2f52,#120f1f 72%)",
  其他: "radial-gradient(130% 130% at 50% 22%,#2a3040,#0d1018 72%)",
};
const ph = (a: Asset) => PH[a.type || "其他"] || PH["其他"];
const GEN_PRESETS = ["角色三视图设定", "电影感关键帧", "场景概念图", "道具特写", "统一画风/色调"];

type GMsg = { id: number; role: "user" | "ai"; text: string; refs?: string[]; imgs?: string[]; pending?: boolean; error?: boolean };

export default function AssetLibrary({
  projectId, projectName, canEdit, bible, assets, scriptText,
}: {
  projectId: string; projectName: string; canEdit: boolean; bible: BibleFields; assets: Asset[]; scriptText: string;
}) {
  const router = useRouter();
  const localClient = createClient();
  const [tab, setTab] = useState<string>("人物");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"chat" | "gen">("chat");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // gen state
  const [gMsgs, setGMsgs] = useState<GMsg[]>([]);
  const [gInput, setGInput] = useState("");
  const [gModel, setGModel] = useState(IMG_MODELS[0].id);
  const [gRatio, setGRatio] = useState("9:16");
  const [gRefs, setGRefs] = useState<{ id: number; url: string; file: File }[]>([]);
  const [gBusy, setGBusy] = useState(false);
  const idRef = useRef(0);
  const gFileRef = useRef<HTMLInputElement>(null);

  const matchTab = (a: Asset) => tab === "其他" ? !["人物", "场景", "道具"].includes(a.type || "") : a.type === tab;
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter(matchTab).filter((a) => !q || (a.name + (a.description || "")).toLowerCase().includes(q));
  }, [assets, tab, search]);
  const countOf = (t: string) => assets.filter((a) => t === "其他" ? !["人物", "场景", "道具"].includes(a.type || "") : a.type === t).length;
  const detail = assets.find((a) => a.id === detailId) || null;

  const bibleText = [bible.logline && `梗概：${bible.logline}`, bible.style && `画风/主色调：${bible.style}`, bible.characters && `主要人物：${bible.characters}`, bible.worldRules && `世界观：${bible.worldRules}`, bible.taboos && `负向词：${bible.taboos}`].filter(Boolean).join("\n");
  const chatSystem = `你是 FG Studio 的资产顾问 AI，为 AI 漫剧《${projectName}》设计人物/场景/道具。依据故事圣经与剧本，给出资产设定与可直接用于出图的中文提示词（保持画风一致、锁脸一致）。\n\n=== 故事圣经 ===\n${bibleText || "（未填）"}\n\n=== 剧本节选 ===\n${scriptText ? scriptText.slice(0, 4000) : "（暂无）"}`;

  async function onUpload(files: FileList | null) {
    if (!files || !files.length) return; setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const path = `${projectId}/${slugType(tab)}/up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${(f.name.split(".").pop() || "png").toLowerCase()}`;
        const { error } = await localClient.storage.from("project-assets").upload(path, f, { upsert: false });
        if (!error) await createAsset(projectId, { name: f.name.replace(/\.[^.]+$/, ""), type: tab, source: "upload", storage_path: path });
      }
      router.refresh();
    } finally { setBusy(false); }
  }

  async function doExtract() {
    if (!scriptText) { alert("还没有剧本可拆解，先去剧本工作台写/生成剧本。"); return; }
    setBusy(true);
    try {
      const sys = `从下面的剧本中提取所有「人物、场景、道具」。只返回 JSON：{"assets":[{"name":"名称","type":"人物|场景|道具","role":"一句话设定/作用","prompt":"用于AI出图的中文提示词，含外形/材质/光影/风格"}]}。不要多余文字。`;
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, model: "deepseek-flash", jsonOutput: true, messages: [{ role: "system", content: sys }, { role: "user", content: scriptText.slice(0, 8000) }] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI 失败");
      let parsed: any = {}; try { parsed = JSON.parse(data.content || "{}"); } catch { parsed = {}; }
      const arr: any[] = parsed.assets || [];
      const exist = new Set(assets.map((a) => a.name));
      let n = 0;
      for (const it of arr) {
        const name = String(it.name || "").trim(); if (!name || exist.has(name)) continue;
        const type = ["人物", "场景", "道具"].includes(it.type) ? it.type : "人物";
        await createAsset(projectId, { name, type, source: "script", description: String(it.role || ""), gen_prompt: String(it.prompt || ""), from_script: true }); n++;
      }
      router.refresh();
      alert(n ? `已从剧本拆解出 ${n} 个资产，去对应分类查看并生图。` : "未发现新资产（可能已存在）。");
    } catch (e: any) { alert("拆解失败：" + (e?.message || "")); } finally { setBusy(false); }
  }

  async function createNew() {
    if (!newName.trim()) return; setBusy(true);
    try { await createAsset(projectId, { name: newName.trim(), type: tab, source: "manual" }); setNewName(""); setNewOpen(false); router.refresh(); } finally { setBusy(false); }
  }
  async function onDelete(a: Asset) { if (!confirm(`删除资产「${a.name}」？`)) return; await deleteAsset(projectId, a.id, a.storage_path); setDetailId(null); router.refresh(); }
  async function toggleLock(a: Asset) { await setLockRef(projectId, a.id, !a.is_lock_ref, a.name); router.refresh(); }

  function pickGRefs(files: FileList | null) { if (!files) return; const add = Array.from(files).filter((f) => f.type.startsWith("image/")).map((f) => ({ id: ++idRef.current, url: URL.createObjectURL(f), file: f })); setGRefs((p) => [...p, ...add].slice(0, 4)); }
  async function genSend(promptOverride?: string) {
    const text = (promptOverride ?? gInput).trim(); if (!text || gBusy) return;
    const refsPrev = gRefs.map((r) => r.url); const refFiles = gRefs.map((r) => r.file);
    const uid = ++idRef.current, gid = ++idRef.current;
    setGMsgs((m) => [...m, { id: uid, role: "user", text, refs: refsPrev.length ? refsPrev : undefined }, { id: gid, role: "ai", text: "", pending: true }]);
    setGInput(""); setGRefs([]); setGBusy(true);
    const tempPaths: string[] = [];
    try {
      const payload: any = { projectId, type: tab, model: gModel, size: sizeFor(gModel, gRatio), prompt: text };
      if (refFiles.length) {
        const urls: string[] = [];
        for (const file of refFiles) {
          const ext = (file.name.split('.').pop() || 'png').toLowerCase();
          const path = `${projectId}/gen-refs/ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error } = await localClient.storage.from('project-assets').upload(path, file, { upsert: false });
          if (error) throw new Error('上传参考图失败：' + error.message);
          tempPaths.push(path);
          urls.push(localClient.storage.from('project-assets').getPublicUrl(path).data.publicUrl);
        }
        payload.refUrls = urls;
      }
      const d = await generateImage(payload);
      setGMsgs((m) => m.map((x) => x.id === gid ? { ...x, pending: false, text: "已生成并存入「" + tab + "」资产", imgs: [d.url] } : x));
      router.refresh();
    } catch (e: any) { setGMsgs((m) => m.map((x) => x.id === gid ? { ...x, pending: false, error: true, text: e?.message || "网络错误" } : x)); } finally {
      if (tempPaths.length) await localClient.storage.from('project-assets').remove(tempPaths);
      setGBusy(false);
    }
  }

  const stBadge = (a: Asset) => a.source === "upload" ? { t: "上传", ink: "#9db4ff" } : a.from_script ? { t: "剧本拆解", ink: "#ffc06a" } : { t: "AI 生成", ink: "var(--accent)" };

  // ---------- RIGHT : dual panel ----------
  const right = (
    <aside style={{ flex: "none", width: 392, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--stroke)", background: "var(--panel)", backdropFilter: "blur(26px) saturate(1.4)", WebkitBackdropFilter: "blur(26px) saturate(1.4)" }}>
      <div style={{ flex: "none", padding: "14px 16px 12px", borderBottom: "1px solid var(--stroke)" }}>
        <div style={{ display: "flex", padding: 4, borderRadius: 13, background: "var(--bg-2)", border: "1px solid var(--stroke)", gap: 4 }}>
          {([["chat", "对话", ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"]], ["gen", "生图", ["M3 3h18v18H3z", "M9 9a2 2 0 1 0 0-.01", "m21 15-5-5L5 21"]]] as const).map(([k, lbl, d]) => {
            const on = mode === k;
            return <button key={k} onClick={() => setMode(k as any)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 9, borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 500, color: on ? "var(--accent-ink)" : "var(--text-2)", background: on ? "var(--accent)" : "transparent", border: "none", transition: "all .3s var(--ease)" }}><Icon d={d} size={16} sw={1.7} />{lbl}</button>;
          })}
        </div>
      </div>

      {mode === "chat" ? (
        <AiPanel embedded projectId={projectId} scope="assets" title="资产顾问" badge="FG-Asset" contextNote={bibleText ? "已读取 故事圣经 · 剧本" : "圣经/剧本待完善"} system={chatSystem}
          quick={["按剧本设计主角外形", "给这个场景写出图提示词", "保持画风统一的负向词"]} placeholder="询问资产设定，或让 AI 依剧本写出图提示词……（⌘↵）" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div style={{ flex: "none", padding: "12px 16px", borderBottom: "1px solid var(--stroke)", display: "flex", gap: 8 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 38, borderRadius: 11, fontSize: 12.5, fontWeight: 500, color: "var(--accent-ink)", background: "var(--accent)" }}><Icon d={["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"]} size={15} sw={1.7} />对话式生图</div>
            <button onClick={() => router.push(`/projects/${projectId}/assets/canvas`)} title="画布式生图（下一步接入）" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 38, borderRadius: 11, cursor: "pointer", fontSize: 12.5, fontWeight: 500, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}><Icon d={["M6 6m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M6 18m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M18 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M8.2 7 15.5 11M8.2 17 15.5 13"]} size={15} sw={1.7} />画布式生图</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
            {gMsgs.length === 0 && <div style={{ margin: "auto", textAlign: "center", color: "var(--text-3)", fontSize: 13, lineHeight: 1.7, maxWidth: 250 }}>描述要生成的画面，可上传参考图保持角色一致。<br />出图会自动存入「{tab}」分类。</div>}
            {gMsgs.map((m) => m.role === "user" ? (
              <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                {m.refs && <div style={{ display: "flex", gap: 6 }}>{m.refs.map((u, i) => <img key={i} src={u} alt="" style={{ width: 46, height: 46, borderRadius: 9, objectFit: "cover", border: "1px solid var(--user-stroke)" }} />)}</div>}
                <div style={{ maxWidth: "86%", padding: "11px 13px", borderRadius: "15px 4px 15px 15px", background: "var(--user-bubble)", border: "1px solid var(--user-stroke)", fontSize: 13, lineHeight: 1.6 }}>{m.text}</div>
              </div>
            ) : (
              <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ flex: "none", width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", color: "var(--accent)" }}><Icon d={["M3 3h18v18H3z", "m21 15-5-5L5 21"]} size={15} sw={1.6} /></div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: m.error ? "#ff9a8a" : "var(--text-2)", marginBottom: m.imgs ? 8 : 0 }}>{m.pending ? "生成中…（约 10–40 秒）" : m.text}</div>
                  {m.imgs && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{m.imgs.map((u, i) => <img key={i} src={u} alt="" style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", borderRadius: 11, border: "1px solid var(--stroke-2)" }} />)}</div>}
                  {m.imgs && <div style={{ display: "flex", gap: 7, marginTop: 9 }}><button onClick={() => genSend(gMsgs.find((x) => x.id === m.id - 1)?.text)} style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontSize: 12, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}><Icon d={["M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5"]} size={13} sw={1.8} />再生成</button></div>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ flex: "none", padding: "12px 16px 16px", borderTop: "1px solid var(--stroke)" }}>
            <div className="fg-mono" style={{ fontSize: 9.5, letterSpacing: 1, color: "var(--text-3)", marginBottom: 7 }}>固定提示词 · GPT-Image 库</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {GEN_PRESETS.map((p) => <button key={p} onClick={() => setGInput((v) => v ? v + "，" + p : p)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, cursor: "pointer", fontSize: 11.5, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent-2)" }} />{p}</button>)}
            </div>
            <div style={{ borderRadius: 15, background: "var(--bg-2)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", overflow: "hidden" }}>
              {gRefs.length > 0 && <div style={{ display: "flex", gap: 7, padding: "10px 12px 0", flexWrap: "wrap" }}>{gRefs.map((r) => <div key={r.id} style={{ position: "relative" }}><img src={r.url} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", border: "1px solid var(--stroke-2)" }} /><button onClick={() => setGRefs((p) => p.filter((x) => x.id !== r.id))} style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", border: "none", cursor: "pointer", background: "var(--panel-solid)", color: "var(--text)", fontSize: 10 }}>✕</button></div>)}</div>}
              <textarea value={gInput} onChange={(e) => setGInput(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); genSend(); } }} placeholder="描述要生成的画面，或上传参考图保持一致……" rows={2} style={{ display: "block", width: "100%", resize: "none", border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, lineHeight: 1.6, padding: "12px 13px 4px", fontFamily: "inherit" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 8px" }}>
                <input ref={gFileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { pickGRefs(e.target.files); e.currentTarget.value = ""; }} />
                <button onClick={() => gFileRef.current?.click()} title="上传参考图" style={{ width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-2)", background: "transparent", border: "1px solid var(--stroke)" }}><Icon d={["M3 4h18v16H3z", "M9 9a2 2 0 1 0 0-.01", "m3 17 5-4 4 3 3-2 6 5"]} size={16} sw={1.6} /></button>
                <select value={gModel} onChange={(e) => setGModel(e.target.value)} className="fg-mono" style={{ fontSize: 11, color: "var(--text-2)", background: "var(--panel-solid)", border: "1px solid var(--stroke)", borderRadius: 8, padding: "5px 4px", maxWidth: 166, cursor: "pointer" }}>{IMG_MODELS.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}</select>
                <select value={gRatio} onChange={(e) => setGRatio(e.target.value)} className="fg-mono" style={{ fontSize: 11, color: "var(--text-2)", background: "var(--panel-solid)", border: "1px solid var(--stroke)", borderRadius: 8, padding: "5px 4px", cursor: "pointer" }}>{RATIOS.map((r) => <option key={r.key} value={r.key}>{r.key}</option>)}</select>
                <div style={{ flex: 1 }} />
                <Hov as="button" onClick={() => genSend()} disabled={gBusy} base={{ display: "flex", alignItems: "center", gap: 7, height: 36, padding: "0 5px 0 13px", borderRadius: 12, cursor: gBusy ? "default" : "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 20px -8px var(--accent)", opacity: gBusy ? 0.6 : 1 }} hover={gBusy ? undefined : { filter: "brightness(1.08)" }}>生成<span style={{ width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--accent-ink)", color: "var(--accent)" }}><Icon d={["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"]} size={14} sw={2} /></span></Hov>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );

  return (
    <StudioShell projectId={projectId} projectName={projectName} stageKey="assets" right={right}>
      <div style={{ flex: "none", padding: "20px 28px 14px", borderBottom: "1px solid var(--stroke)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 18, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}>
              <span className="fg-mono" style={{ fontSize: 11, letterSpacing: 2, color: "var(--text-3)" }}>ASSETS</span>
              <span className="fg-script" style={{ fontSize: 22, color: "var(--accent)", lineHeight: 1, transform: "rotate(-5deg)", textShadow: "0 0 18px var(--glow-a)" }}>cast &amp; world</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-.6px" }}>资产库 <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-3)" }}>人物 · 场景 · 道具</span></h1>
          </div>
          {canEdit && <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Hov as="button" onClick={doExtract} base={{ display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 14px", borderRadius: 12, cursor: "pointer", fontSize: 13, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)", transition: "all .3s var(--ease)" }} hover={{ color: "var(--text)", background: "var(--panel-2)", borderColor: "var(--stroke-2)" }}><Icon d={["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M14 3v6h6", "m9 14 2 2 4-4"]} size={16} sw={1.7} />{busy ? "处理中…" : "从剧本拆解资产"}</Hov>
            <Hov as="button" onClick={() => setNewOpen(true)} base={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 6px 0 15px", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 8px 20px -8px var(--accent)", transition: "all .3s var(--ease)" }} hover={{ filter: "brightness(1.08)" }}>新建资产<span style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--accent-ink)", color: "var(--accent)" }}><Icon d={["M12 5v14M5 12h14"]} size={15} sw={2} /></span></Hov>
          </div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", padding: 3, borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--stroke)", gap: 3 }}>
            {TABS.map((t) => { const on = tab === t; return (
              <button key={t} onClick={() => setTab(t)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 500, color: on ? "var(--text)" : "var(--text-3)", background: on ? "var(--panel-2)" : "transparent", border: "none", transition: "all .3s var(--ease)" }}><Icon d={TAB_ICON[t]} size={15} sw={1.7} />{t}<span className="fg-mono" style={{ fontSize: 10.5, padding: "1px 6px", borderRadius: 6, background: on ? "var(--accent)" : "var(--bg-2)", color: on ? "var(--accent-ink)" : "var(--text-3)" }}>{countOf(t)}</span></button>
            ); })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 200, maxWidth: 340, height: 40, padding: "0 13px", borderRadius: 12, background: "var(--panel)", border: "1px solid var(--stroke)" }}>
            <Icon d={["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "m20 20-3.5-3.5"]} size={17} sw={1.7} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索资产名称、设定……" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, fontFamily: "inherit" }} />
          </div>
          {canEdit && <><input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { onUpload(e.target.files); e.currentTarget.value = ""; }} /><button onClick={() => fileRef.current?.click()} style={{ height: 40, padding: "0 13px", borderRadius: 12, cursor: "pointer", fontSize: 12.5, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}>上传到「{tab}」</button></>}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 28px 60px" }}>
        {list.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-3)", padding: "60px 0", border: "1.5px dashed var(--stroke-2)", borderRadius: 18 }}>「{tab}」分类暂无资产。点右上「从剧本拆解资产」自动生成，或在右侧「生图」直接出图。</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(228px,1fr))", gap: 18 }}>
            {list.map((a) => { const u = thumbUrl(a); const st = stBadge(a); return (
              <Hov key={a.id} onClick={() => setDetailId(a.id)} base={{ position: "relative", borderRadius: 18, overflow: "hidden", cursor: "pointer", background: "var(--panel)", border: "1px solid var(--stroke)", boxShadow: "var(--inset)", transition: "all .3s var(--ease)" }} hover={{ transform: "translateY(-3px)", borderColor: "var(--stroke-2)", boxShadow: "var(--inset),var(--shadow)" }}>
                <div style={{ position: "relative", aspectRatio: "4/5", background: u ? "var(--bg-2)" : ph(a) }}>
                  {u && <img src={u} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                  <div style={{ position: "absolute", left: 10, top: 10 }}><span className="fg-mono" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: st.ink, padding: "3px 8px", borderRadius: 7, background: "rgba(0,0,0,.34)", backdropFilter: "blur(6px)" }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: st.ink }} />{st.t}</span></div>
                  {a.is_lock_ref && <div style={{ position: "absolute", right: 10, top: 10 }} className="fg-mono"><span style={{ fontSize: 10, color: "#fff", padding: "3px 8px", borderRadius: 7, background: "rgba(0,0,0,.4)", backdropFilter: "blur(6px)" }}>锁脸</span></div>}
                </div>
                <div style={{ padding: "13px 14px 15px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.2px" }}>{a.name}</span>
                    <span className="fg-mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{a.type}</span>
                  </div>
                  <div style={{ marginTop: 7, fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as any}>{a.description || (a.gen_prompt ? a.gen_prompt.slice(0, 60) : "—")}</div>
                </div>
              </Hov>
            ); })}
          </div>
        )}
      </div>

      {/* 新建资产 modal */}
      {newOpen && (
        <div onClick={() => setNewOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.5)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 380, maxWidth: "100%", background: "var(--panel-solid)", border: "1px solid var(--stroke)", borderRadius: 18, padding: 22, boxShadow: "var(--shadow)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>新建资产 · {tab}</div>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createNew(); }} placeholder="资产名称（如：林夏 / 观测舱 / 鱼骨门环）" style={{ width: "100%", height: 42, borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--stroke)", padding: "0 13px", color: "var(--text)", outline: "none", fontSize: 14, marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setNewOpen(false)} style={{ height: 38, padding: "0 14px", borderRadius: 11, cursor: "pointer", fontSize: 13, color: "var(--text-2)", background: "var(--panel)", border: "1px solid var(--stroke)" }}>取消</button>
              <button onClick={createNew} disabled={!newName.trim()} style={{ height: 38, padding: "0 16px", borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", opacity: newName.trim() ? 1 : 0.5 }}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 资产详情抽屉 */}
      {detail && (
        <div onClick={() => setDetailId(null)} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,.5)", backdropFilter: "blur(5px)", display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px,94vw)", height: "100%", display: "flex", flexDirection: "column", background: "var(--panel-solid)", borderLeft: "1px solid var(--stroke-2)", boxShadow: "var(--shadow)" }}>
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "18px 22px", borderBottom: "1px solid var(--stroke)" }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--stroke-2)", color: "var(--accent)" }}><Icon d={TAB_ICON[detail.type || "其他"] || TAB_ICON["其他"]} size={17} sw={1.7} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{detail.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>{detail.type} · {detail.from_script ? "剧本拆解" : detail.source === "upload" ? "上传" : "AI 生成"}</div>
              </div>
              <button onClick={() => setDetailId(null)} style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-3)", background: "transparent", border: "1px solid var(--stroke)" }}><Icon d={["M6 6l12 12M18 6 6 18"]} size={17} sw={1.8} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ position: "relative", aspectRatio: "1/1", borderRadius: 18, overflow: "hidden", background: thumbUrl(detail) ? "var(--bg-2)" : ph(detail), border: "1px solid var(--stroke-2)", boxShadow: "var(--inset)" }}>
                {thumbUrl(detail) ? <img src={thumbUrl(detail) as string} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 13 }}>暂无图 · 用右侧「生图」出图</div>}
              </div>
              {detail.description && <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-2)" }}>{detail.description}</div>}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>生成提示词</span><button onClick={() => { setMode("gen"); setGInput(detail.gen_prompt || (detail.params as any)?.prompt || detail.name); }} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer" }}><Icon d={["M3 3h18v18H3z", "m21 15-5-5L5 21"]} size={13} sw={1.7} />用它去生图</button></div>
                <EditArea value={detail.gen_prompt || (detail.params as any)?.prompt || ""} disabled={!canEdit} minH={120} placeholder="用于 AI 出图的中文提示词。可手写，或让左侧资产顾问按剧本生成。" onSave={(v) => updateAsset(projectId, detail.id, { gen_prompt: v })} style={{ fontSize: 13, lineHeight: 1.7 }} />
              </div>
            </div>
            {canEdit && <div style={{ flex: "none", display: "flex", gap: 10, padding: "16px 22px", borderTop: "1px solid var(--stroke)" }}>
              <button onClick={() => toggleLock(detail)} style={{ height: 44, padding: "0 14px", borderRadius: 12, cursor: "pointer", fontSize: 13, color: detail.is_lock_ref ? "var(--accent-ink)" : "var(--text-2)", background: detail.is_lock_ref ? "var(--accent)" : "var(--panel)", border: "1px solid var(--stroke)" }}>{detail.is_lock_ref ? "✓ 锁脸参考" : "设为锁脸参考"}</button>
              <button onClick={() => onDelete(detail)} style={{ height: 44, padding: "0 14px", borderRadius: 12, cursor: "pointer", fontSize: 13, color: "var(--text-3)", background: "transparent", border: "1px solid var(--stroke)" }}>删除</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => { setMode("gen"); setGInput(detail.gen_prompt || detail.name); setDetailId(null); }} style={{ height: 44, padding: "0 18px", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)", border: "none", boxShadow: "var(--inset),0 9px 22px -10px var(--accent)" }}>生成图片</button>
            </div>}
          </div>
        </div>
      )}
    </StudioShell>
  );
}
