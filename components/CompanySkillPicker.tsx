"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Eye, LoaderCircle, Sparkles, X } from "lucide-react";

import { WORKFLOW_SKILLS } from "@/lib/skillData";

export type CompanySelectedSkill = { name: string; content: string };

type Props = {
  selected: CompanySelectedSkill[];
  onChange: (skills: CompanySelectedSkill[]) => void;
};

type WorkflowSkill = (typeof WORKFLOW_SKILLS)[number];

export default function CompanySkillPicker({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<WorkflowSkill | null>(null);
  const [contentById, setContentById] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const selectedNames = useMemo(() => new Set(selected.map((item) => item.name)), [selected]);

  useEffect(() => {
    if (!open && preview) setPreview(null);
  }, [open, preview]);

  async function loadContent(skill: WorkflowSkill) {
    if (contentById[skill.id]) return contentById[skill.id];
    setLoadingId(skill.id);
    try {
      const response = await fetch(`/skills/${skill.file}`);
      if (!response.ok) throw new Error("读取失败");
      const content = await response.text();
      if (!content.trim()) throw new Error("内容为空");
      setContentById((current) => ({ ...current, [skill.id]: content }));
      return content;
    } finally {
      setLoadingId((current) => current === skill.id ? null : current);
    }
  }

  async function toggle(skill: WorkflowSkill) {
    if (selectedNames.has(skill.title)) {
      onChange(selected.filter((item) => item.name !== skill.title));
      return;
    }
    if (selected.length >= 4) return;
    try {
      const content = await loadContent(skill);
      onChange([...selected, { name: skill.title, content }]);
    } catch {
      // The detail pane keeps the error surface local; the main composer remains usable.
    }
  }

  async function openPreview(skill: WorkflowSkill) {
    setPreview(skill);
    try { await loadContent(skill); } catch { /* rendered below */ }
  }

  const previewContent = preview ? contentById[preview.id] : "";

  return (
    <>
      <button type="button" className={`fg-company-skill-trigger${selected.length ? " active" : ""}`} onClick={() => setOpen(true)}>
        <Sparkles size={14} /> {selected.length ? `${selected.length} 个 Skill` : "选择 Skill"}
      </button>
      {open ? <div className="fg-company-skill-backdrop" onMouseDown={() => setOpen(false)}>
        <section className="fg-company-skill-picker" aria-label="选择公司模型工作流 Skill" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><span>PRODUCTION METHODS</span><h2>选择要叠加的方法</h2><p>最多 4 个。选择不会自动生成；你仍会在分镜与报价页确认后才开始制作。</p></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭 Skill 选择器"><X size={18} /></button>
          </header>
          <div className="fg-company-skill-picker-body">
            <div className="fg-company-skill-list">
              {WORKFLOW_SKILLS.map((skill) => {
                const checked = selectedNames.has(skill.title);
                const isLoading = loadingId === skill.id;
                return <article className={checked ? "selected" : ""} key={skill.id}>
                  <button type="button" className="fg-company-skill-select" onClick={() => void toggle(skill)} disabled={isLoading || (!checked && selected.length >= 4)}>
                    <span className="fg-company-skill-check">{checked ? <Check size={13} /> : null}</span>
                    <span><strong>{skill.title}</strong><small>{skill.desc}</small></span>
                    {isLoading ? <LoaderCircle className="spin" size={14} /> : null}
                  </button>
                  <button type="button" className="fg-company-skill-preview" onClick={() => void openPreview(skill)}><Eye size={13} /> 查看</button>
                </article>;
              })}
            </div>
            <aside className="fg-company-skill-detail">
              {preview ? <><div className="fg-company-skill-detail-head"><span>SKILL DETAIL</span><strong>{preview.title}</strong><small>{preview.desc}</small></div>{loadingId === preview.id ? <div className="fg-company-skill-detail-loading"><LoaderCircle className="spin" size={16} /> 正在读取 Skill 内容…</div> : previewContent ? <pre>{previewContent}</pre> : <div className="fg-company-skill-detail-loading">无法读取此 Skill 的内容，请稍后再试。</div>}</> : <div className="fg-company-skill-detail-empty"><Eye size={18} /> 点击“查看”可阅读完整方法、限制和交付格式。</div>}
            </aside>
          </div>
          <footer><span>已选 {selected.length}/4</span><div>{selected.map((item) => <button key={item.name} type="button" onClick={() => onChange(selected.filter((current) => current.name !== item.name))}>{item.name}<X size={12} /></button>)}</div><button type="button" className="primary" onClick={() => setOpen(false)}>完成</button></footer>
        </section>
      </div> : null}
    </>
  );
}
