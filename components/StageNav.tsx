"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { STAGES } from "@/lib/types";

// 八阶段步骤条：current 高亮，有 href 的可跳，未上线的灰显并提示
export default function StageNav({ projectId, current }: { projectId: string; current: string }) {
  const router = useRouter();
  const [hint, setHint] = useState("");

  function go(stageKey: string, href?: (id: string) => string) {
    if (href) { router.push(href(projectId)); return; }
    setHint(`「${STAGES.find((s) => s.key === stageKey)?.label}」即将上线`);
    setTimeout(() => setHint(""), 2200);
  }

  return (
    <div className="relative glass-bar">
      <div className="flex items-stretch gap-1 overflow-x-auto px-6 py-2.5">
        {STAGES.map((s) => {
          const active = s.key === current;
          const live = !!s.href;
          return (
            <button
              key={s.key}
              onClick={() => go(s.key, s.href)}
              className={[
                "group flex flex-none items-center gap-2 rounded-xl px-3 py-1.5 text-[12.5px] transition",
                active
                  ? "bg-primary text-white"
                  : live
                  ? "text-ink hover:bg-[#f4f4f6]"
                  : "cursor-default text-[#bcbcc6]",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-5 w-5 flex-none place-items-center rounded-md font-mono text-[10px]",
                  active ? "bg-white/20 text-white" : live ? "bg-[#ececed] text-[#75758a]" : "bg-[#f4f4f6] text-[#cfcfd6]",
                ].join(" ")}
              >
                {s.n}
              </span>
              <span className="whitespace-nowrap font-disp font-medium">{s.label}</span>
              {!live && <span className="font-mono text-[9px] uppercase tracking-wide opacity-70">soon</span>}
            </button>
          );
        })}
      </div>
      {hint && (
        <div className="pointer-events-none absolute right-6 top-full z-20 mt-1 rounded-lg bg-primary px-3 py-1.5 text-[12px] text-white shadow-lg">
          {hint}
        </div>
      )}
    </div>
  );
}
