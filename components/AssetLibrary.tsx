"use client";
import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createAsset, deleteAsset, setLockRef } from "@/app/projects/[id]/assets/actions";
import { ASSET_TYPES, slugType, type Asset } from "@/lib/types";
import { IMG_MODELS, RATIOS, sizeFor } from "@/lib/imageModels";
import PromptPicker from "@/components/PromptPicker";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
function publicUrl(path?: string | null) { return path ? `${SB_URL}/storage/v1/object/public/project-assets/${path}` : null; }
function thumb(a: Asset) { return a.external_url || publicUrl(a.storage_path) || publicUrl(a.poster_path); }
function fileToB64(file: File): Promise<{ b64: string; type: string }> {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => { const s = String(r.result); resolve({ b64: s.split(",")[1] || "", type: file.type || "image/png" }); }; r.onerror = reject; r.readAsDataURL(file); });
}
async function urlToB64(url: string): Promise<{ b64: string; type: string } | null> {
  try { const r = await fetch(url); const b = await r.blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res({ b64: String(fr.result).split(",")[1] || "", type: b.type || "image/png" }); fr.onerror = () => res(null); fr.readAsDataURL(b); }); } catch { return null; }
}
function friendlyErr(msg: string) { return /timeout|超时|timed?\s?out|INVOCATION/i.test(msg) ? "生成超时。换更快的模型（nano-banana-2 / gemini-3-pro-image）或缩短提示词再试。" : msg; }
function Trash() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" /></svg>; }
function Lock() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>; }
function Send() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>; }
function Clip() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8" /></svg>; }
function Ph() { return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5L5 20" /></svg>; }
function Spk() { return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" /></svg>; }

type GenMsg = { id: number; role: "user" | "img" | "err"; text?: string; url?: string; ref?: string; pending?: boolean };
type Tile = { id: number; url: string; file?: File };

export default function AssetLibrary({ projectId, canEdit, assets }: { projectId: string; canEdit: boolean; assets: Asset[] }) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const canvasUpload = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const [type, setType] = useState<string>("全部");
  const [busy, setBusy] = useState(false);
  const [genMode, setGenMode] = useState<"chat" | "canvas">("chat");
  const [model, setModel] = useState(IMG_MODELS[0].id);
  const [ratio, setRatio] = useState("9:16");
  const [prompt, setPrompt] = useState("");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refPreview, setRefPreview] = useState<string | null>(null);
  const [messages, setMessages] = useState<GenMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [pickAsset, setPickAsset] = useState(false);
  const [cPrompt, setCPrompt] = useState("");
  const [cBusy, setCBusy] = useState(false);
  const [cErr, setCErr] = useState<string | null>(null);
  const [cResult, setCResult] = useState<string | null>(null);

  const cur = type === "全部" ? "人物" : type;
  const list = type === "全部" ? assets : assets.filter((a) => a.type === type);
  const imgAssets = assets.filter((a) => a.type !== "声音" && (a.storage_path || a.external_url));

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []); if (!files.length) return; setBusy(true);
    for (const f of files) {
      const safe = f.name.replace(/[^\w.\-]+/g, "_"); const path = `${projectId}/${slugType(cur)}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from("project-assets").upload(path, f, { upsert: false });
      if (error) { alert("上传失败：" + error.message); continue; }
      await createAsset(projectId, { name: f.name, type: cur, source: "upload", storage_path: path });
    }
    setBusy(false); e.target.value = ""; router.refresh();
  }
  async function onDelete(a: Asset) { if (!confirm(`删除资产「${a.name}」？`)) return; setBusy(true); await deleteAsset(projectId, a.id, a.storage_path); setBusy(false); router.refresh(); }
  async function onLock(a: Asset) {
    if (a.is_lock_ref) { await setLockRef(projectId, a.id, false); }
    else { const name = window.prompt("设为「锁脸参考」，绑定角色名（之后分镜/关键帧出场该角色时自动用这张脸保持一致）：", a.char_name || a.name || ""); if (name === null) return; await setLockRef(projectId, a.id, true, name.trim()); }
    router.refresh();
  }
  function pickRef(e: ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f) return; setRefFile(f); setRefPreview(URL.createObjectURL(f)); e.target.value = ""; }
  function clearRef() { setRefFile(null); setRefPreview(null); }
  function addTilesFromFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setTiles((t) => [...t, ...files.map((f) => ({ id: ++idRef.current, url: URL.createObjectURL(f), file: f }))]); e.target.value = "";
  }
  function addTileFromAsset(a: Asset) { const u = thumb(a); if (!u) return; setTiles((t) => [...t, { id: ++idRef.current, url: u }]); }
  function removeTile(id: number) { setTiles((t) => t.filter((x) => x.id !== id)); }

  async function send() {
    const text = prompt.trim(); if (!text || sending) return;
    const uid = ++idRef.current; const gid = ++idRef.current; const refUsed = refPreview || undefined; const fileForSend = refFile;
    setMessages((m) => [...m, { id: uid, role: "user", text, ref: refUsed }, { id: gid, role: "img", pending: true }]);
    setPrompt(""); clearRef(); setSending(true);
    try {
      const payload: any = { projectId, type: cur, model, size: sizeFor(model, ratio), prompt: text };
      if (fileForSend) { const { b64, type: t } = await fileToB64(fileForSend); payload.refImage = b64; payload.refType = t; }
      const { data: d, error: invErr } = await supabase.functions.invoke("gen-image", { body: payload });
      if (invErr || !d?.ok) { setMessages((m) => m.map((x) => (x.id === gid ? { ...x, role: "err", pending: false, text: friendlyErr((d && d.error) || invErr?.message || "生成失败") } : x))); }
      else { setMessages((m) => m.map((x) => (x.id === gid ? { ...x, pending: false, url: d.url } : x))); router.refresh(); }
    } catch (e: any) { setMessages((m) => m.map((x) => (x.id === gid ? { ...x, role: "err", pending: false, text: friendlyErr(e?.message || "网络错误") } : x))); }
    finally { setSending(false); }
  }
  async function genCanvas() {
    if (!cPrompt.trim()) { setCErr("写一句 Prompt"); return; }
    setCBusy(true); setCErr(null);
    try {
      const refImages: string[] = []; const refTypes: string[] = [];
      for (const t of tiles) { const r = t.file ? await fileToB64(t.file) : await urlToB64(t.url); if (r) { refImages.push(r.b64); refTypes.push(r.type); } }
      const payload: any = { projectId, type: cur, model, size: sizeFor(model, ratio), prompt: cPrompt.trim() };
      if (refImages.length) { payload.refImages = refImages; payload.refTypes = refTypes; }
      const { data: d, error } = await supabase.functions.invoke("gen-image", { body: payload });
      if (error || !d?.ok) { setCErr(friendlyErr((d && d.error) || error?.message || "生成失败")); return; }
      setCResult(d.url); router.refresh();
    } catch (e: any) { setCErr(e?.message || "网络错误"); } finally { setCBusy(false); }
  }

  const railItem = (active: boolean) => ["flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition", active ? "bg-[#34d399]/14 text-[#1d9e75] ring-1 ring-[#34d399]/30 dark:text-[#5fe3c0]" : "text-black/65 hover:bg-black/5 dark:text-white/65 dark:hover:bg-white/6"].join(" ");

  return (
    <div className="mx-auto flex max-w-[1620px] flex-col gap-4 px-4 py-4 lg:h-[calc(100vh-108px)] lg:flex-row">
      {/* 左：分类 */}
      <aside className="lglass flex w-full flex-none flex-col overflow-hidden rounded-[20px] lg:w-[212px]">
        <div className="border-b border-black/8 px-4 py-3 dark:border-white/8"><div className="font-disp text-[14px] font-semibold">资产分类</div></div>
        <div className="flex-1 space-y-1 overflow-auto p-2">
          {["全部", ...ASSET_TYPES].map((t) => (
            <button key={t} onClick={() => setType(t)} className={railItem(t === type)}>
              <span>{t}</span><span className="font-mono text-[11px] opacity-60">{t === "全部" ? assets.length : assets.filter((a) => a.type === t).length}</span>
            </button>
          ))}
        </div>
        {canEdit && (
          <div className="border-t border-black/8 p-2 dark:border-white/8">
            <input ref={fileRef} type="file" accept="image/*,audio/*" multiple hidden onChange={onUpload} />
            <button className="w-full rounded-lg border border-black/12 px-3 py-2 text-[12.5px] transition hover:border-black/35 dark:border-white/15 dark:hover:border-white/40" disabled={busy} onClick={() => fileRef.current?.click()}>上传到「{cur}」</button>
          </div>
        )}
      </aside>

      {/* 中：资产网格 */}
      <main className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-disp text-[20px] font-semibold tracking-tight">资产库</h2>
          <span className="chip">{type}</span>
          <span className="ml-auto font-mono text-[11px] text-black/40 dark:text-white/40">{list.length} 项</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {list.length === 0 ? (
            <div className="grid h-full place-items-center rounded-[20px] border border-dashed border-black/12 text-center dark:border-white/12">
              <div><p className="text-[15px] font-medium">这个分类还没有资产</p><p className="mt-1 text-[13px] text-black/45 dark:text-white/45">{canEdit ? "右侧生成，或左下「上传」把已有图入库。" : "等成员上传或生成。"}</p></div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4 pb-2">
              {list.map((a) => {
                const src = thumb(a); const isAudio = a.type === "声音";
                return (
                  <div key={a.id} className="group card relative overflow-hidden transition hover:-translate-y-1">
                    {canEdit && <button title="删除" onClick={() => onDelete(a)} disabled={busy} className="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md bg-black/45 text-white opacity-0 backdrop-blur transition hover:bg-red-500 group-hover:opacity-100"><Trash /></button>}
                    {canEdit && a.type === "人物" && <button title={a.is_lock_ref ? "取消锁脸" : "设为锁脸参考"} onClick={() => onLock(a)} disabled={busy} className={`absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md backdrop-blur transition ${a.is_lock_ref ? "bg-[#34d399] text-[#0a2018]" : "bg-black/45 text-white opacity-0 group-hover:opacity-100"}`}><Lock /></button>}
                    <div className="grid h-[130px] place-items-center bg-black/5 text-black/30 dark:bg-white/5 dark:text-white/30">{src && !isAudio ? <img src={src} alt={a.name} className="h-full w-full object-cover" /> : isAudio ? <Spk /> : <Ph />}</div>
                    <div className="p-3">
                      <div className="truncate text-[13.5px] font-semibold" title={a.name}>{a.name}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1"><span className="chip">{a.type || "未分类"}</span><span className="chip">{a.source === "upload" ? "上传" : "AI"}</span>{a.is_lock_ref && <span className="chip chip-green">{a.char_name || "锁脸"}</span>}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* 右：生成工作室（常驻）*/}
      <aside className="flex w-full flex-none flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#0d0d13] text-[#e8e8ee] shadow-[0_28px_70px_-36px_rgba(0,0,0,.85)] lg:h-auto lg:w-[396px]">
        <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
          <span className="font-disp text-[14.5px] font-semibold text-[#5fe3c0]">✦ 生成 · {cur}</span>
          <div className="ml-auto inline-flex rounded-full bg-white/6 p-0.5">
            {(["chat", "canvas"] as const).map((m) => (<button key={m} onClick={() => setGenMode(m)} className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${m === genMode ? "bg-[#34d399] text-[#0a2018]" : "text-white/60"}`}>{m === "chat" ? "对话式" : "画布式"}</button>))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/8 px-4 py-2.5">
          <select className="rounded-md border border-white/12 bg-white/[.05] px-2 py-1.5 text-[12px]" value={model} onChange={(e) => setModel(e.target.value)}>{IMG_MODELS.map((m) => <option key={m.id} value={m.id} className="bg-[#15151b]">{m.label}</option>)}</select>
          <select className="rounded-md border border-white/12 bg-white/[.05] px-2 py-1.5 text-[12px]" value={ratio} onChange={(e) => setRatio(e.target.value)}>{RATIOS.map((r) => <option key={r.key} value={r.key} className="bg-[#15151b]">{r.label}</option>)}</select>
        </div>

        {genMode === "chat" ? (
          <>
            <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
              {messages.length === 0 && <div className="grid h-full place-items-center text-center text-[12.5px] text-white/45"><div><p className="font-medium text-white/70">描述画面，发送即生成</p><p className="mt-1">可附参考图锁脸/换装；结果自动入库「{cur}」。</p></div></div>}
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "user" ? (<div className="max-w-[82%] rounded-2xl rounded-tr-sm bg-white/[.06] px-3 py-2.5 text-[13px] leading-relaxed">{m.ref && <img src={m.ref} alt="参考图" className="mb-2 h-16 w-16 rounded-lg object-cover" />}<div className="whitespace-pre-wrap">{m.text}</div></div>)
                  : m.role === "err" ? (<div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-[#ff7759]/12 px-3 py-2.5 text-[12.5px] leading-relaxed text-[#ff9b85]">⚠ {m.text}</div>)
                  : (<div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-white/8 bg-white/[.03] p-2">{m.pending ? (<div className="grid h-40 w-40 place-items-center text-[12px] text-white/45"><div className="text-center"><div className="animate-pulse">生成中…</div><div className="mt-1 text-[11px]">约 10–40 秒</div></div></div>) : (<><a href={m.url || "#"} target="_blank" rel="noreferrer"><img src={m.url || ""} alt="结果" className="max-h-[360px] w-full rounded-lg object-contain" /></a><div className="px-1 pt-1.5 font-mono text-[10px] text-white/40">已入库 · {cur}</div></>)}</div>)}
                </div>
              ))}
            </div>
            <div className="border-t border-white/8 p-3">
              <div className="mb-2 flex items-center gap-2"><PromptPicker onInsert={(t) => setPrompt((v) => (v ? v + "，" + t : t))} /></div>
              {refPreview && <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/12 bg-white/[.04] p-2"><img src={refPreview} alt="参考图" className="h-11 w-11 rounded-lg object-cover" /><span className="flex-1 truncate text-[12px] text-white/55">{refFile?.name}</span><button className="text-[12px] text-[#ff9b85]" onClick={clearRef}>移除</button></div>}
              <div className="flex items-end gap-2">
                <input ref={refInput} type="file" accept="image/*" hidden onChange={pickRef} />
                <button title="附参考图" className="grid h-11 w-10 flex-none place-items-center rounded-xl border border-white/12 text-white/65 hover:text-[#5fe3c0]" onClick={() => refInput.current?.click()}><Clip /></button>
                <textarea className="max-h-40 min-h-[44px] flex-1 resize-y rounded-xl border border-white/12 bg-white/[.05] px-3 py-2.5 text-[13.5px] outline-none focus:border-[#5fe3c0]" placeholder={refFile ? "参考这张脸，换装/换姿势…" : "描述画面（可点 Prompt 插入画风/负向词）"} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
                <button className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-[#34d399] text-[#0a2018] disabled:opacity-50" disabled={sending || !prompt.trim()} onClick={send}><Send /></button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-auto p-4">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-white/40">参考图板 · 脸 + 服装 + 场景 → 合成一帧</div>
            <div className="flex flex-wrap gap-2">
              {tiles.map((t) => (<div key={t.id} className="group relative h-20 w-20 overflow-hidden rounded-xl border border-white/12"><img src={t.url} alt="ref" className="h-full w-full object-cover" /><button onClick={() => removeTile(t.id)} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-md bg-black/55 text-[11px] text-white opacity-0 transition group-hover:opacity-100">✕</button></div>))}
              <input ref={canvasUpload} type="file" accept="image/*" multiple hidden onChange={addTilesFromFiles} />
              <button onClick={() => canvasUpload.current?.click()} className="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-white/15 text-[11px] text-white/45 hover:border-[#34d399] hover:text-[#5fe3c0]">＋ 上传</button>
              <button onClick={() => setPickAsset((p) => !p)} className="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-white/15 text-center text-[11px] text-white/45 hover:border-[#34d399] hover:text-[#5fe3c0]">资产库选</button>
            </div>
            {pickAsset && <div className="mt-3 max-h-36 overflow-auto rounded-xl border border-white/10 bg-white/[.03] p-2">{imgAssets.length === 0 ? <p className="p-2 text-center text-[12px] text-white/45">资产库还没有图片。</p> : <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-2">{imgAssets.map((a) => (<button key={a.id} onClick={() => addTileFromAsset(a)} title={a.name} className="h-14 overflow-hidden rounded-lg border border-white/10 hover:border-[#34d399]"><img src={thumb(a) || ""} alt={a.name} className="h-full w-full object-cover" /></button>))}</div>}</div>}
            <div className="mt-3"><PromptPicker onInsert={(t) => setCPrompt((v) => (v ? v + "，" + t : t))} /></div>
            <textarea className="input mt-2 min-h-[88px] border-white/12 bg-white/[.05] text-white placeholder:text-white/30" value={cPrompt} onChange={(e) => setCPrompt(e.target.value)} placeholder="例：第1张的脸 + 第2张的红斗篷，放进第3张森林场景，全身站姿，无文字。" />
            {cErr && <div className="mt-2 rounded-lg bg-[#ff7759]/12 px-3 py-2 text-[12.5px] text-[#ff9b85]">⚠ {cErr}</div>}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[11px] text-white/40">{tiles.length ? `${tiles.length} 张参考图合成` : "纯文生图"}</span>
              <button className="rounded-full bg-[#34d399] px-4 py-2 text-[13px] font-medium text-[#0a2018] disabled:opacity-50" disabled={cBusy} onClick={genCanvas}>{cBusy ? "合成中…" : "合成生成"}</button>
            </div>
            {cResult && <a href={cResult} target="_blank" rel="noreferrer"><img src={cResult} alt="结果" className="mt-3 w-full rounded-xl border border-white/12" /></a>}
          </div>
        )}
      </aside>
    </div>
  );
}
