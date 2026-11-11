// FG canvas inspiration library (灵感库), read in place from the canvas web/public folder when it is on this computer.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.FG_CANVAS_PUBLIC,
  'D:/FG.AI/fg-studio/production-lab/meilin/canvas/web/public',
  'D:/FG.AI/.local/fg-main-read/production-lab/meilin/canvas/web/public',
].filter(Boolean);

export const CANVAS_PUBLIC = CANDIDATES.find((p) => existsSync(join(p, 'inspirations', 'manifest.json'))) || null;
const SOURCES = { youmind: 'YouMind 提示词库 · CC BY 4.0', haohaoxue: '好好学 AI', seedance: 'awesome-seedance · CC BY 4.0' };
let cache = null;

function load() {
  if (cache || !CANVAS_PUBLIC) return cache || [];
  const out = [];
  for (const src of Object.keys(SOURCES)) {
    try {
      const raw = JSON.parse(readFileSync(join(CANVAS_PUBLIC, 'inspirations', `${src}.json`), 'utf8'));
      const arr = Array.isArray(raw) ? raw : raw.entries || [];
      for (const it of arr) out.push({ id: it.id, title: it.title, description: it.description, mode: it.mode, prompt: it.prompt, image: `/fg-public${it.image}`, credit: it.credit || '', source: SOURCES[src] });
    } catch { /* skip missing source */ }
  }
  cache = out;
  return out;
}

export function search({ q = '', mode = '', limit = 60, offset = 0 }) {
  const t = q.trim().toLowerCase();
  const all = load().filter((x) => (!mode || x.mode === mode) && (!t || `${x.title} ${x.description} ${x.prompt}`.toLowerCase().includes(t)));
  return { connected: Boolean(CANVAS_PUBLIC), total: all.length, items: all.slice(offset, offset + limit) };
}

export const byId = (id) => load().find((x) => x.id === id);
