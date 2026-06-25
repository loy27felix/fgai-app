"use client";
import { useRef, useState } from "react";
async function readDataUrl(f: File): Promise<string> { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); }); }
import { BIBLE_LABELS, type BibleFields } from "@/lib/types";
import { saveBible, toggleLock } from "@/app/projects/[id]/bible/actions";
import { TEXT_MODELS } from "@/lib/models";
import { createClient } from "@/lib/supabase/client";
import ChatHistoryBar from "@/components/ChatHistoryBar";
import SkillPicker from "@/components/SkillPicker";
import PromptPicker from "@/components/PromptPicker";
import { upsertSession } from "@/lib/chatStore";

type Msg = { role: "user" | "assistant"; content: string; importable?: BibleFields };

const FIELD_ORDER: (keyof BibleFields)[] = ["logline", "genre", "worldRules", "style", "characters", "taboos"];

export default function BibleWorkspace({
  projectId, projectName, emoji, locked: lockedInit, canEdit, initialFields,
}: {
  projectId: string; projectName: string; emoji: string;
  locked: boolean; canEdit: boolean; initialFields: BibleFields;
}) {
  const supabase = createClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeSkill, setActiveSkill] = useState<{ name: string; content: string } | null>(null);
  const [chatImg, setChatImg] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState<BibleFields>(initialFields || {});
  const [locked, setLocked] = useState(lockedInit);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "我已载入这个项目的故事圣经记忆。可以让我「破题」：确定核心冲突、世界观、人物与画风，确认后一键填进左侧字段。" },
  ]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>("deepseek-flash");
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  function setField(k: keyof BibleFields, v: string) {
    setFields((f) => ({ ...f, [k]: v }));
  }

  async function doSave() {
    setSaved("保存中…");
    const r = await saveBible(projectId, fields);
    setSaved(r?.ok ? "已保存 ✓" : `保存失败：${r?.error || ""}`);
    setTimeout(() => setSaved(""), 2500);
  }

  async function doLock() {
    const next = !locked;
    setLocked(next);
    await toggleLock(projectId, next);
  }

  function memorySystemPrompt(): string {
    const f = fields;
    return [
      "你是 FG Studio 里某个 AI 漫剧项目的专属编剧助理。",
      `当前项目：《${projectName}》。`,
      "下面是该项目已确定的故事圣经（全局记忆），回答必须与之保持一致，不要跑偏：",
      `- 一句话梗概：${f.logline || "（未填）"}`,
      `- 题材/时长：${f.genre || "（未填）"}`,
      `- 世界观底层规则：${f.worldRules || "（未填）"}`,
      `- 画风/主色调：${f.style || "（未填）"}`,
      `- 主要人物：${f.characters || "（未填）"}`,
      `- 禁忌/负向：${f.taboos || "（未填）"}`,
    ].join("\n");
  }

  async function callAI(history: { role: "user" | "assistant"; content: string }[], json = false, imgs?: string[]) {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        model,
        thinking,
        jsonOutput: json,
        images: imgs,
        messages: [{ role: "system", content: memorySystemPrompt() + (activeSkill ? "\n\n=== 已启用技能：" + activeSkill.name + " ===\n" + activeSkill.content : "") }, ...history],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "AI 请求失败");
    return data.content as string;
  }

  async function persist(allMsgs: Msg[], firstText: string) {
    try { const id = await upsertSession(supabase, { id: sessionId, projectId, scope: "bible", title: sessionId ? "" : firstText, messages: allMsgs }); if (!sessionId && id) setSessionId(id); } catch {}
  }
  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setBusy(true);
    try {
      const imgs = chatImg ? [chatImg] : undefined; setChatImg(null);
      const content = await callAI(next.map(({ role, content }) => ({ role, content })), false, imgs);
      const all: Msg[] = [...next, { role: "assistant", content }];
      setMsgs(all);
      persist(all, text);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: "⚠️ " + (e?.message || "出错了") }]);
    } finally {
      setBusy(false);
    }
  }

  // 让 AI 破题并产出可一键导入的结构化字段
  async function breakdown() {
    if (busy) return;
    setBusy(true);
    const afterUser: Msg[] = [...msgs, { role: "user", content: "请帮我破题，并以 JSON 给出故事圣经字段。" }];
    setMsgs(afterUser);
    try {
      const instruct =
        "请基于项目记忆破题，只输出合法 JSON，不要解释、不要 markdown。" +
        '格式：{"logline":string,"genre":string,"worldRules":string,"style":string,"characters":string,"taboos":string}';
      const content = await callAI(
        [...msgs.map(({ role, content }) => ({ role, content })), { role: "user", content: instruct }],
        true
      );
      let parsed: BibleFields | undefined;
      try { parsed = JSON.parse(content) as BibleFields; } catch { parsed = undefined; }
      const reply: Msg = parsed
        ? { role: "assistant", content: "已破题，给出故事圣经草案。确认无误可一键导入到左侧字段。", importable: parsed }
        : { role: "assistant", content };
      const all: Msg[] = [...afterUser, reply];
      setMsgs(all);
      persist(all, "AI 破题");
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: "⚠️ " + (e?.message || "出错了") }]);
    } finally {
      setBusy(false);
    }
  }

  function importFields(f: BibleFields) {
    setFields((cur) => ({ ...cur, ...f }));
    setSaved("已导入到字段，记得保存");
    setTimeout(() => setSaved(""), 2500);
  }

  const act = "rounded-full border border-black/12 px-4 py-1.5 text-[13px] transition hover:border-black/35 dark:border-white/15 dark:hover:border-white/40";

  return (
    <div className="mx-auto flex max-w-[1560px] flex-col gap-4 px-4 py-4 lg:h-[calc(100vh-108px)] lg:flex-row">
      {/* 左：故事圣经字段 */}
      <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2.5 font-disp text-[22px] font-semibold tracking-tight"><span>{emoji}</span> 立项 & 故事圣经 {locked && <span className="chip chip-green">已锁定</span>}</h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canEdit && <button className={act} onClick={doLock}>{locked ? "解锁" : "锁定"}</button>}
            {canEdit && <button className="rounded-full bg-[#34d399] px-5 py-1.5 text-[13px] font-medium text-[#0a2018] active:scale-[.98]" onClick={doSave}>保存</button>}
            {saved && <span className="text-[12.5px] text-[#1d9e75] dark:text-[#5fe3c0]">{saved}</span>}
          </div>
        </div>
        <p className="max-w-[680px] text-[13.5px] leading-relaxed text-black/55 dark:text-white/50">项目的全局记忆。在右侧与 AI 破题，确认后一键导入下方字段并保存；锁定后跨集一致，自动注入到本项目的 AI 调用。</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {FIELD_ORDER.map((k) => (
            <div key={k} className="lglass rounded-[18px] p-4">
              <label className="mb-2 block font-mono text-[11.5px] uppercase tracking-wide text-black/45 dark:text-white/45">{BIBLE_LABELS[k]}</label>
              <textarea className="min-h-[104px] w-full resize-y rounded-xl border border-hairline bg-transparent p-3 text-[14.5px] leading-relaxed outline-none focus:border-[#34d399]" disabled={!canEdit} value={fields[k] || ""} onChange={(e) => setField(k, e.target.value)} placeholder={canEdit ? "手动填写，或用 AI 破题后一键导入" : "（只读）"} />
            </div>
          ))}
        </div>
      </main>

      {/* 右：AI 助手（高级深色玻璃对话框）*/}
      <aside className="flex w-full flex-none flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#0d0d13] text-[#e8e8ee] shadow-[0_28px_70px_-36px_rgba(0,0,0,.85)] lg:h-auto lg:w-[392px]">
        <div className="flex h-[52px] items-center gap-2 border-b border-white/8 px-4">
          <span className="font-disp text-[15px] font-semibold text-[#5fe3c0]">✦ AI 助手</span>
          <div className="ml-auto"><ChatHistoryBar projectId={projectId} scope="bible" sessionId={sessionId} onLoad={(m, id) => { setMsgs(m as Msg[]); setSessionId(id); }} onNew={() => { setMsgs([{ role: "assistant", content: "新对话开始。可以让我「破题」：确定核心冲突、世界观、人物与画风，确认后一键填进左侧字段。" }]); setSessionId(null); }} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/8 px-4 py-2.5">
          <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-md border border-white/12 bg-white/[.05] px-2 py-1.5 text-[12.5px]">{TEXT_MODELS.map((m) => <option key={m.id} value={m.id} className="bg-[#15151b]">{m.label}</option>)}</select>
          <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-white/45"><input type="checkbox" checked={thinking} onChange={(e) => setThinking(e.target.checked)} /> 思考</label>
          <button className="ml-auto rounded-full bg-[#34d399] px-3.5 py-1.5 text-[12px] font-medium text-[#0a2018] disabled:opacity-50" onClick={breakdown} disabled={busy}>AI 破题</button>
        </div>
        <div className="flex-1 space-y-4 overflow-auto p-4">
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`grid h-7 w-7 flex-none place-items-center rounded-lg text-[12px] font-medium ${m.role === "user" ? "bg-white/10 text-[#5fe3c0]" : "bg-[#34d399] text-[#0a2018]"}`}>{m.role === "user" ? "你" : "AI"}</div>
              <div className={`max-w-[85%] rounded-2xl border border-white/8 p-3 text-[14px] leading-relaxed ${m.role === "user" ? "rounded-tr-sm bg-white/[.06]" : "rounded-tl-sm bg-white/[.03]"}`}>
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.importable && <button className="mt-2.5 rounded-lg bg-[#34d399] px-3 py-1.5 text-[12.5px] font-medium text-[#0a2018]" onClick={() => importFields(m.importable!)}>一键导入到字段</button>}
              </div>
            </div>
          ))}
          {busy && <div className="font-mono text-[11px] text-white/45">AI 思考中…</div>}
        </div>
        <div className="border-t border-white/8 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SkillPicker active={activeSkill?.name || null} onApply={(name, content) => setActiveSkill({ name, content })} onClear={() => setActiveSkill(null)} />
            <PromptPicker onInsert={(t) => setInput((v) => (v ? v + "\n" + t : t))} />
            <input ref={imgRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setChatImg(await readDataUrl(f)); e.target.value = ""; }} />
            <button onClick={() => imgRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-2.5 py-1 text-[11.5px] text-white/70 transition hover:bg-white/8"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.6" /><path d="M21 15l-5-5L5 21" /></svg>图片</button>
            {activeSkill && <span className="inline-flex items-center gap-1 rounded-md bg-[#34d399]/12 px-2 py-1 text-[11px] text-[#5fe3c0]">技能：{activeSkill.name}<button onClick={() => setActiveSkill(null)} className="opacity-70 hover:opacity-100">✕</button></span>}
          </div>
          {chatImg && <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/12 bg-white/[.04] p-2"><img src={chatImg} alt="附图" className="h-11 w-11 rounded-lg object-cover" /><span className="flex-1 text-[12px] text-white/55">图片已附加（发送时用视觉模型解析）</span><button onClick={() => setChatImg(null)} className="text-[12px] text-[#ff9b85]">移除</button></div>}
          <div className="flex items-end gap-2">
            <textarea className="max-h-40 min-h-[46px] flex-1 resize-y rounded-xl border border-white/12 bg-white/[.05] px-3 py-2.5 text-[14px] outline-none focus:border-[#5fe3c0]" placeholder="和 AI 对话（带项目记忆）…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-[#34d399] text-[#0a2018] disabled:opacity-50" onClick={send} disabled={busy}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
          </div>
        </div>
      </aside>
    </div>
  );
}
