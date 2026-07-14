export type Role = "owner" | "editor" | "viewer";

export interface Project {
  id: string;
  name: string;
  summary: string | null;
  story_bible: BibleFields;
  style_locked: boolean;
  cover: string | null;
  created_by: string | null;
  created_at: string;
}

export interface BibleFields {
  logline?: string;
  genre?: string;
  worldRules?: string;
  style?: string;
  characters?: string;
  taboos?: string;
  _emoji?: string;
}

export const BIBLE_FIELD_ORDER: (keyof BibleFields)[] = [
  "logline", "genre", "worldRules", "style", "characters", "taboos",
];

export const BIBLE_LABELS: Record<string, string> = {
  logline: "一句话梗概",
  genre: "题材 / 时长",
  worldRules: "世界观底层规则",
  style: "画风 / 主色调",
  characters: "主要人物",
  taboos: "禁忌 / 全局负向词",
};

// ── ② 剧本工作台 ──
export interface Episode { id: string; project_id: string; idx: number; title: string | null; }
export interface Scene { id: string; episode_id: string; idx: number; title: string | null; setting: string | null; }
export interface Script { id: string; scene_id: string; body: string | null; source: string | null; current_version: number | null; updated_at: string; }
export interface ScriptVersion { id: string; script_id: string; version: number; body: string | null; author: string | null; source: string | null; created_at: string; }

// ── ③ 资产库 ──
export interface Asset {
  id: string;
  project_id: string;
  name: string;
  type: string | null;
  source: string | null;        // upload | generated
  storage_path: string | null;  // project-assets 桶内路径
  external_url: string | null;
  poster_path: string | null;
  params: any;
  tags: string[] | null;
  reusable: boolean;
  version: number;
  created_at: string;
  is_lock_ref?: boolean;
  char_name?: string | null;
  description?: string | null;
  gen_prompt?: string | null;
  from_script?: boolean;
}
export type LockRef = { char_name: string; url: string };
export const ASSET_TYPES = ["人物", "服装", "化妆", "道具", "场景", "声音", "风格"];
export const TYPE_SLUG: Record<string, string> = { 人物: "char", 服装: "outfit", 化妆: "makeup", 道具: "prop", 场景: "scene", 声音: "audio", 风格: "style" };
export function slugType(t?: string | null): string { if (!t) return "misc"; return TYPE_SLUG[t] || (/^[\w.-]+$/.test(t) ? t : "misc"); }

// 七阶段（单一数据源）
export interface Stage {
  n: string;
  key: string;
  label: string;
  href?: (projectId: string) => string;
}

export const STAGES: Stage[] = [
  { n: "01", key: "bible",  label: "立项 & 故事圣经", href: (id) => `/projects/${id}/bible` },
  { n: "02", key: "script", label: "剧本工作台",     href: (id) => `/projects/${id}/script` },
  { n: "03", key: "assets", label: "资产库",         href: (id) => `/projects/${id}/assets` },
  { n: "04", key: "board",  label: "导演分镜表", href: (id) => `/projects/${id}/board` },
  { n: "05", key: "shots",  label: "逐镜头设计", href: (id) => `/projects/${id}/shots` },
  { n: "06", key: "video",  label: "生视频", href: (id) => `/projects/${id}/video` },
  { n: "07", key: "bgm",    label: "BGM / 音频", href: (id) => `/projects/${id}/bgm` },
];

export const COVERS = [
  "linear-gradient(140deg,#0a3d34,#05221d)",
  "linear-gradient(140deg,#1e1733,#2f1f47)",
  "linear-gradient(140deg,#2a1a12,#3f2418)",
  "linear-gradient(140deg,#07273e,#0c3a52)",
  "linear-gradient(140deg,#241026,#3d1d38)",
  "linear-gradient(140deg,#0c1626,#15304c)",
];
