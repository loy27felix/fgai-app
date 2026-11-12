import { createHash } from 'node:crypto';
import { redactSupportText } from './redact';

export const SUPPORT_PAYLOAD_LIMIT = 131072;
const FIELD_LIMIT = 24;
const NODE_LIMIT = 2000;
const OUTPUT_LIMIT = 6000;
const protectedKey = /token|secret|password|authorization|authentication|headers|connectionstring|databaseurl|dsn|cookie|apikey|accesskey|credential|privatekey|signature|email|phone|address|sessionkey/i;
const mediaKey = /^(?:base64|b64json|imagebase64|audiobase64|videobase64|binary|buffer|bytesdata|rawdata)$/i;
type Field = { path: string; kind: string; value?: string | number | boolean | null; count?: number; chars?: number; start?: number; sanitizedChars?: number };
export type PayloadSelection = { pointer?: string; offset?: number };
export type PayloadEvidence = {
  state: 'available' | 'missing' | 'unreadable' | 'not_found' | 'protected';
  recordedComplete: boolean; truncated: boolean; redacted: boolean; fields: Field[];
  pointer: string; offset: number; snapshotId?: string; nextOffset?: number; reasons: string[];
};

function segments(pointer: string): string[] {
  if (pointer.length > 600 || /[\x00-\x1f\x7f]/.test(pointer) || pointer && !pointer.startsWith('/') || /~(?![01])/.test(pointer)) {
    throw new Error('参数路径必须是有效的 JSON Pointer，最多600字符');
  }
  return pointer ? pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')) : [];
}
function normalize(key: string) { return key.replace(/[^a-z0-9]/gi, ''); }
function protectedPart(key: string, value?: unknown) {
  const name = normalize(key);
  if (typeof value === 'number' && /^(?:max(?:output|completion)?tokens|(?:input|output|total|prompt|completion|cached)tokens|tokencount)$/i.test(name)) return false;
  return protectedKey.test(name) || /密码|密钥|令牌|签名|邮箱|手机号/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)
    || ['key', 'auth', 'jwt', 'bearer'].includes(name.toLowerCase());
}
function sensitiveEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return ['name', 'key', 'field'].some(key => typeof record[key] === 'string' && protectedPart(String(record[key])));
}
function mediaPart(key: string, parent: string) {
  return mediaKey.test(normalize(key)) || normalize(key) === 'data' && /inline.?data|image|audio|video|binary|buffer/i.test(parent);
}

// Parameters are projected into path/value facts, never passed through as arbitrary objects.
// 参数只投影为路径/值事实，不透传任意对象，避免原有通用脱敏器删除 prompt/parameters 或放行嵌套密钥。
export function projectSupportPayload(raw: unknown, complete: boolean, selection: PayloadSelection = {}): PayloadEvidence {
  const pointer = selection.pointer ?? '';
  const offset = selection.offset ?? 0;
  if (typeof pointer !== 'string' || !Number.isInteger(offset) || offset < 0 || offset > NODE_LIMIT * 2) throw new Error('参数分页无效');
  const parts = segments(pointer);
  const result: PayloadEvidence = { state: 'available', recordedComplete: complete, truncated: false, redacted: false,
    fields: [], pointer: redactSupportText(pointer), offset, reasons: [] };
  const unavailable = (state: PayloadEvidence['state'], reason: string) => ({ ...result, state, reasons: [reason] });
  if (typeof raw !== 'string' || !raw.trim()) return unavailable('missing', 'not_recorded');
  if (!complete || raw.length > SUPPORT_PAYLOAD_LIMIT) return { ...unavailable('unreadable', 'stored_or_read_limit'), truncated: true, recordedComplete: false };
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { return unavailable('unreadable', 'not_json_or_omitted_at_capture'); }
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return unavailable('not_found', 'path_not_recorded'); } }
    if (sensitiveEntry(value) || part.length > 160 || redactSupportText(part) !== part) return { ...unavailable('protected', 'sensitive_or_media_field'), redacted: true };
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return unavailable('not_found', 'path_not_recorded');
    const child = (value as Record<string, unknown>)[part];
    if (protectedPart(part, child) || mediaPart(part, parts.slice(0, index).join('/'))) return { ...unavailable('protected', 'sensitive_or_media_field'), redacted: true };
    value = child;
  }
  const fields: Field[] = [];
  let nodes = 0;
  function visit(item: unknown, path: string, depth: number) {
    if (++nodes > NODE_LIMIT) return;
    if (depth > 16 || path.length > 600) { result.truncated = true; result.reasons.push('structure_limit'); return; }
    const safePath = redactSupportText(path);
    if (typeof item === 'string') {
      if (/data:[^,\s]*;base64,|(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{160,}={0,2}(?:$|[^A-Za-z0-9+/])/i.test(item)) {
        result.redacted = true;
        fields.push({ path: safePath, kind: 'media_omitted', chars: item.length });
        return;
      }
      // Serialized nested JSON receives the same key protection; a string is not a safe escape hatch.
      // 字符串内序列化的 JSON 同样按字段保护，不能作为绕过密钥过滤的通道。
      if (/^\s*[{[]/.test(item)) {
        let nested: unknown;
        try { nested = JSON.parse(item); } catch { /* Ordinary text, not embedded JSON. / 普通文本，并非嵌套 JSON。 */ }
        if (nested && typeof nested === 'object') { visit(nested, path, depth + 1); return; }
      }
      const safe = redactSupportText(item, SUPPORT_PAYLOAD_LIMIT);
      result.redacted ||= safe !== item || /\[(?:REDACTED|内嵌媒体|内嵌编码)/i.test(item);
      for (let start = 0; start < safe.length || start === 0; start += 1200) {
        fields.push({ path: safePath, kind: 'string', value: safe.slice(start, start + 1200), chars: item.length, sanitizedChars: safe.length, start });
      }
      return;
    }
    if (typeof item === 'number' && !Number.isFinite(item)) { result.truncated = true; result.reasons.push('non_finite_number'); return; }
    if (item === null || typeof item === 'boolean' || typeof item === 'number') {
      fields.push({ path: safePath, kind: item === null ? 'null' : typeof item, value: item as null | number | boolean });
      return;
    }
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item) && item.length > 128 && item.every(value => typeof value === 'number')) {
      result.redacted = true;
      fields.push({ path: safePath, kind: 'numeric_array_omitted', count: item.length });
      return;
    }
    if (sensitiveEntry(item)) {
      result.redacted = true;
      fields.push({ path: safePath, kind: 'sensitive_entry_omitted' });
      return;
    }
    const entries = Object.entries(item);
    if (Array.isArray(item) || !entries.length) fields.push({ path: safePath, kind: Array.isArray(item) ? 'array' : 'object', count: entries.length });
    for (const [key, child] of entries) {
      if (nodes >= NODE_LIMIT) { result.truncated = true; result.reasons.push('node_limit'); break; }
      if (protectedPart(key, child) || mediaPart(key, path)) { result.redacted = true; continue; }
      // Map keys may themselves contain signed URLs, credentials or private text.
      // 对象键也可能是签名 URL、凭据或私有文本，不能原样当成公开字段路径。
      if (key.length > 160 || redactSupportText(key) !== key || /[\x00-\x1f]/.test(key)) { result.redacted = true; continue; }
      visit(child, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, depth + 1);
    }
  }
  visit(value, pointer, 0);
  result.snapshotId = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  let size = 0;
  for (const field of fields.slice(offset)) {
    const bytes = JSON.stringify(field).length;
    if (result.fields.length >= FIELD_LIMIT || size + bytes > OUTPUT_LIMIT) { result.nextOffset = offset + result.fields.length; break; }
    result.fields.push(field); size += bytes;
  }
  if (result.nextOffset !== undefined) { result.truncated = true; result.reasons.push('page_limit'); }
  result.reasons = [...new Set(result.reasons)];
  return result;
}

// A later narrow field read must not mark an unread whole document as complete.
// 后续只读取一个字段，不能将之前未读完的整份报文标为完整；分页仅合并同一脱敏快照。
export function supportPayloadPagesComplete(pages: PayloadEvidence[]): boolean {
  const root = pages.filter(page => page.pointer === '' && page.offset === 0).at(-1);
  if (!root?.snapshotId) return false;
  let offset = 0;
  const seen = new Set<number>();
  while (!seen.has(offset)) {
    seen.add(offset);
    const page = pages.findLast(item => item.snapshotId === root.snapshotId && item.pointer === '' && item.offset === offset);
    if (!page || page.state !== 'available' || !page.recordedComplete || page.reasons.some(reason => reason !== 'page_limit')) return false;
    if (page.nextOffset === undefined) return !page.truncated;
    offset = page.nextOffset;
  }
  return false;
}
