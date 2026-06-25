"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Item = { title: string; desc: string; prompt: string };
const PRESETS: { cat: string; emoji: string; tip: string; items: Item[] }[] = [
  { cat: "画风", emoji: "🎨", tip: "粘进生图 Prompt 的画风段，或写进故事圣经「画风/主色调」。", items: [
    { title: "暗黑童话水墨", desc: "暗黑童话短剧常用", prompt: "暗黑童话风格，水墨晕染叠加厚涂质感，冷调高对比，胶片颗粒，电影级布光，神秘压抑氛围" },
    { title: "国潮赛博", desc: "古风×未来", prompt: "国潮水墨线条融合赛博朋克，霓虹冷光，未来都市背景，高饱和强对比，东方美学" },
    { title: "日系厚涂", desc: "清透治愈", prompt: "日系厚涂动画，柔和光影，细腻笔触，清透通透色彩，2.5D 质感，唯美氛围" },
    { title: "皮克斯 3D", desc: "圆润可爱", prompt: "皮克斯式 3D 动画，圆润造型，柔和次表面散射，暖色布光，电影级渲染，亲和力强" },
    { title: "暗黑写实 UE5", desc: "电影质感", prompt: "暗黑写实风，低饱和，强体积光，电影级景深，Unreal Engine 5 渲染，8K 细节" },
  ]},
  { cat: "运镜", emoji: "🎬", tip: "粘进「⑥ 生视频」的视频 Prompt，决定镜头如何动。", items: [
    { title: "缓推聚焦", desc: "营造紧张/强调", prompt: "镜头缓慢推进（slow dolly in），逐渐聚焦主体面部，营造紧张与压迫感" },
    { title: "拉镜揭示", desc: "交代环境", prompt: "镜头缓慢拉远（dolly out），从主体揭示整个环境全貌，信息渐次展开" },
    { title: "环绕镜头", desc: "立体展示", prompt: "镜头环绕主体 180 度弧形运动（arc shot），立体呈现角色与空间关系" },
    { title: "子弹时间", desc: "高光定格", prompt: "子弹时间（bullet time），时间凝滞，镜头多角度环绕主体缓慢移动" },
    { title: "手持跟随", desc: "纪实临场", prompt: "手持跟随（handheld follow），轻微自然晃动，紧贴角色，纪实临场感" },
    { title: "希区柯克变焦", desc: "眩晕不安", prompt: "推轨变焦（dolly zoom / vertigo effect），背景压缩，制造眩晕与不安" },
  ]},
  { cat: "角色一致性", emoji: "🧑", tip: "做角色标准图/锁脸参考，配合资产库「锁脸」使用。", items: [
    { title: "六视图角色表", desc: "锁人物造型", prompt: "角色设定表 character turnaround sheet，同一角色正面/侧面/背面+3/4 共六视图，T-pose，纯色背景，五官与服装严格一致，无文字水印" },
    { title: "表情九宫格", desc: "锁表情", prompt: "同一角色 3×3 表情设定表（喜/怒/哀/惊/恐/嫌恶/平静/狡黠/疲惫），五官严格一致，纯色背景，无文字" },
    { title: "换装三视图", desc: "同人不同装", prompt: "同一角色不同服装三视图，严格保持脸部与身形比例一致，纯色背景，无文字" },
    { title: "25 宫格体检", desc: "一致性自检", prompt: "5×5 共 25 格角色设定表，同一角色不同角度与表情，画风统一、五官一致，纯色背景，无文字水印" },
  ]},
  { cat: "构图 / 分镜", emoji: "🖼️", tip: "粘进分镜图/关键帧 Prompt，控制画面构图。", items: [
    { title: "低角度压迫", desc: "强势/威胁", prompt: "低角度仰拍，主体显得高大具压迫感，广角轻微畸变，强势氛围" },
    { title: "框中框", desc: "纵深引导", prompt: "框中框构图，以门/窗/缝隙为前景框，引导视线，强烈纵深感" },
    { title: "三分法留白", desc: "呼吸感", prompt: "三分法/黄金分割构图，主体置于趣味中心，大面积留白营造呼吸感" },
    { title: "过肩对话", desc: "对话镜头", prompt: "过肩镜头（over-the-shoulder），前景虚化肩背，焦点落在对话主体上" },
  ]},
  { cat: "负向词", emoji: "🚫", tip: "追加到任意生图 Prompt 末尾，避免常见崩坏。", items: [
    { title: "通用负面词", desc: "干净画面", prompt: "无文字，无水印，无 logo，无多余手指，不崩脸，不畸形，肢体正常，画面干净" },
    { title: "漫剧负面词", desc: "短剧专用", prompt: "禁止字幕/水印/品牌 logo；避免多手指、融合肢体、人脸畸变、低龄卡通；保持画风统一与人物一致" },
    { title: "古风负面词", desc: "避免穿帮", prompt: "无现代物品，无现代建筑，无手机/电线/汽车，无文字水印，符合古风设定" },
  ]},
];
const SKILLS = [
  { title: "DeepWhite 编剧", desc: "短剧剧本方法 + 格式规范", file: "screenwriting.md" },
  { title: "DeepWhite 分镜表构建", desc: "剧本→镜头表 v2.7", file: "shotlist-builder.md" },
  { title: "DeepWhite 图像提示词构建", desc: "中英双语静帧 Prompt", file: "image-prompt-builder.md" },
  { title: "Seedance 2.0 视频导演", desc: "场景→双语视频 Prompt(JSON)", file: "seedance-director.md" },
  { title: "编剧·三大方法论", desc: "麦基/坎贝尔/亚里士多德(俄文)", file: "screenwriter.md" },
];
const SKILL_TAB = "工作流 Skill";
const FELIX_TAB = "Felix 提示词库";
const MINE_TAB = "我的 Skill";

export default function PresetLibrary() {
  const sb = createClient();
  const [cat, setCat] = useState(PRESETS[0].cat);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [mine, setMine] = useState<any[]>([]);
  const [nt, setNt] = useState(""); const [nb, setNb] = useState("");
  const [felix, setFelix] = useState<{ name: string; items: { title: string; note: string; prompt: string }[] }[]>([]);
  const [fcat, setFcat] = useState("");

  function flash(k: string) { setCopied(k); setTimeout(() => setCopied(null), 1500); }
  function copyText(text: string, key: string) { navigator.clipboard?.writeText(text); flash(key); }
  async function copyFile(file: string, key: string) {
    try { const r = await fetch(`/skills/${file}`); const t = await r.text(); await navigator.clipboard.writeText(t); flash(key); } catch { alert("读取失败"); }
  }
  async function loadMine() { const { data } = await sb.from("custom_presets").select("*").order("created_at", { ascending: false }); setMine(data || []); }
  async function loadFelix() { if (felix.length) return; try { const r = await fetch("/felix-prompts.json"); const d = await r.json(); setFelix(d.tabs || []); setFcat((d.tabs?.[0]?.name) || ""); } catch { } }
  useEffect(() => { if (cat === MINE_TAB) loadMine(); if (cat === FELIX_TAB) loadFelix(); /* eslint-disable-next-line */ }, [cat]);
  async function addMine() { if (!nt.trim() || !nb.trim()) return; await sb.from("custom_presets").insert({ title: nt.trim(), body: nb.trim() }); setNt(""); setNb(""); loadMine(); }
  async function delMine(id: string) { if (!confirm("删除这条 Skill？")) return; await sb.from("custom_presets").delete().eq("id", id); loadMine(); }

  const group = PRESETS.find((g) => g.cat === cat);
  const items = group ? group.items.filter((it) => !q || (it.title + it.desc + it.prompt).toLowerCase().includes(q.toLowerCase())) : [];
  const fgroup = felix.find((g) => g.name === fcat);
  const fitems = fgroup ? fgroup.items.filter((it) => !q || (it.title + it.note + it.prompt).toLowerCase().includes(q.toLowerCase())) : [];
  const tabs = [
    ...PRESETS.map((g) => ({ key: g.cat, label: `${g.emoji} ${g.cat} · ${g.items.length}` })),
    { key: SKILL_TAB, label: `${SKILL_TAB} · ${SKILLS.length}` },
    { key: FELIX_TAB, label: FELIX_TAB },
    { key: MINE_TAB, label: MINE_TAB },
  ];
  const showSearch = !!group || cat === FELIX_TAB;

  return (
    <div className="mx-auto max-w-[1080px] px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-disp text-[26px] font-semibold tracking-tight">预设库 · Skill</h2>
          <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-[#616161]">画风/运镜/构图/负向词一键复制；「工作流 Skill」是完整提示词系统；「Felix 提示词库」收录了 169 条漫剧实战 prompt；还能在「我的 Skill」存自己的。</p>
        </div>
        {showSearch && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索…" className="input w-48" />}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setCat(t.key)}
            className={["rounded-pill px-3.5 py-1.5 text-[12.5px] font-medium transition", t.key === cat ? "bg-green text-green-pale" : "bg-stone text-ink hover:bg-[#e6e3dc]"].join(" ")}>{t.label}</button>
        ))}
      </div>

      {/* 静态预设 */}
      {group && (
        <>
          <p className="mt-4 rounded-xl bg-[#faf9f7] px-4 py-2.5 text-[12.5px] text-muted">{group.tip}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {items.map((it) => (
              <div key={it.title} className="card flex flex-col p-4">
                <div className="flex items-center justify-between gap-2"><h3 className="font-disp text-[15px] font-semibold">{it.title}</h3><span className="chip">{it.desc}</span></div>
                <p className="mt-2 flex-1 whitespace-pre-wrap rounded-xl border border-[#ecebe4] bg-[#faf9f7] p-3 font-mono text-[12px] leading-relaxed text-[#444]">{it.prompt}</p>
                <button className="pill pill-sm mt-3 self-start" onClick={() => copyText(it.prompt, it.title)}>{copied === it.title ? "已复制 ✓" : "复制"}</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 工作流 Skill */}
      {cat === SKILL_TAB && (
        <>
          <p className="mt-4 rounded-xl bg-[#faf9f7] px-4 py-2.5 text-[12.5px] text-muted">「复制全文」后，把内容作为第一条消息粘到 AI 对话里，AI 就会按这套方法/格式工作。</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {SKILLS.map((s) => (
              <div key={s.file} className="card flex flex-col p-4">
                <div className="flex items-center gap-2"><span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-green text-green-pale">🛠️</span><div className="min-w-0"><h3 className="truncate font-disp text-[15px] font-semibold">{s.title}</h3><p className="truncate text-[12px] text-muted">{s.desc}</p></div></div>
                <div className="mt-3 flex gap-2"><button className="pill pill-sm" onClick={() => copyFile(s.file, s.file)}>{copied === s.file ? "已复制全文 ✓" : "复制全文"}</button><a className="pill pill-sm pill-ghost" href={`/skills/${s.file}`} target="_blank" rel="noreferrer">查看 ↗</a></div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Felix 提示词库 */}
      {cat === FELIX_TAB && (
        felix.length === 0 ? <div className="mt-6 text-center text-[13px] text-muted">加载中…</div> : (
          <>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {felix.map((g) => (
                <button key={g.name} onClick={() => setFcat(g.name)} className={["rounded-pill px-3 py-1 text-[12px] transition", g.name === fcat ? "bg-ink text-white" : "bg-stone text-ink hover:bg-[#e6e3dc]"].join(" ")}>{g.name} · {g.items.length}</button>
              ))}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {fitems.map((it, i) => (
                <div key={i} className="card flex flex-col p-4">
                  <h3 className="font-disp text-[14.5px] font-semibold">{it.title}</h3>
                  {it.note && <p className="mt-1 text-[12px] leading-relaxed text-muted">{it.note}</p>}
                  <p className="mt-2 max-h-40 flex-1 overflow-auto whitespace-pre-wrap rounded-xl border border-[#ecebe4] bg-[#faf9f7] p-3 font-mono text-[11.5px] leading-relaxed text-[#444]">{it.prompt.length > 600 ? it.prompt.slice(0, 600) + "…" : it.prompt}</p>
                  <button className="pill pill-sm mt-3 self-start" onClick={() => copyText(it.prompt, "fx" + i)}>{copied === "fx" + i ? "已复制全文 ✓" : "复制全文"}</button>
                </div>
              ))}
            </div>
          </>
        )
      )}

      {/* 我的 Skill */}
      {cat === MINE_TAB && (
        <>
          <div className="mt-4 card p-4">
            <h3 className="mb-2 font-disp text-[15px] font-semibold">＋ 新增我的 Skill / Prompt</h3>
            <input value={nt} onChange={(e) => setNt(e.target.value)} placeholder="标题，如：我的爆款开场公式" className="input" />
            <textarea value={nb} onChange={(e) => setNb(e.target.value)} placeholder="把你的提示词/skill 全文粘到这里…" className="input mt-2 min-h-[120px] font-mono text-[12.5px]" />
            <button className="pill pill-sm mt-3" disabled={!nt.trim() || !nb.trim()} onClick={addMine}>保存</button>
          </div>
          {mine.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-hairline py-12 text-center text-[13px] text-muted">还没有自建 Skill，上面加一条。</div> : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {mine.map((m) => (
                <div key={m.id} className="card flex flex-col p-4">
                  <div className="flex items-center justify-between gap-2"><h3 className="font-disp text-[15px] font-semibold">{m.title}</h3><button className="text-[12px] text-coral hover:underline" onClick={() => delMine(m.id)}>删除</button></div>
                  <p className="mt-2 flex-1 whitespace-pre-wrap rounded-xl border border-[#ecebe4] bg-[#faf9f7] p-3 font-mono text-[12px] leading-relaxed text-[#444]">{m.body.length > 400 ? m.body.slice(0, 400) + "…" : m.body}</p>
                  <button className="pill pill-sm mt-3 self-start" onClick={() => copyText(m.body, m.id)}>{copied === m.id ? "已复制 ✓" : "复制"}</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
