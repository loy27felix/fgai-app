import type { PoolClient } from 'pg';
import { normalizeSupportOperationScope, SUPPORT_CANVAS_OWNED_SCOPE, supportCanvasUser, withSupportCanvasReadOnly } from './operations';
import { redactSupportText } from './redact';

const BODY_LIMIT = 65536;
const CALL_LIMIT = 64;
export const OMITTED_VOICE_NOTICE = '此角色未指定对白，样音不发送';
const resourceIdPattern = /^[A-Za-z0-9_.:-]{1,120}$/;
type Row = Record<string, unknown>;
export type GenerationTask = {
  id: string; taskId: string; projectId?: string; requestId?: string; traceId?: string; providerRequestId?: string;
  status: string; kind: string; model?: string; occurredAt: string | Date;
  instructions: string; input: string; inputComplete: boolean; instructionsComplete: boolean;
};
export type GenerationCall = {
  id: string; taskId: string; requestId?: string; traceId?: string; providerRequestId?: string;
  event: string; status: string; httpStatus?: number; input: string; output: string; inputComplete: boolean; outputComplete: boolean;
};

function object(value: unknown): Row | undefined {
  if (typeof value !== 'string' || value.length > BODY_LIMIT) return undefined;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined; }
  catch { return undefined; }
}
function text(value: unknown, limit = 240): string {
  return typeof value === 'string' ? redactSupportText(value).replace(/[<>]/g, '').trim().slice(0, limit) : '';
}
function id(value: unknown): string | undefined {
  return typeof value === 'string' && resourceIdPattern.test(value) && redactSupportText(value) === value ? value : undefined;
}
function resourceFromUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  const match = value.match(/(?:^|\/)api\/(?:public\/)?resources\/([A-Za-z0-9_.:-]{1,120})\/file(?:[?#]|$)/);
  return id(match?.[1]);
}
function speechCue(instructions: string, name: string): string {
  if (!name) return '';
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plain = instructions.replace(/\*\*|__/g, '');
  const lines = plain.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line.startsWith(name) || /(?:不|未|没有|无需|禁止|不要)[^，。；:：]{0,10}(?:说|对白|台词)/.test(line)) continue;
    const direct = new RegExp(`^${escaped}(?:\\s*[（(][^）)]*[）)])?\\s*[：:]\\s*[“"‘「『]`).test(line);
    const spoken = new RegExp(`^${escaped}[^。\\n]{0,100}(?:说|问|答|喊|says?|speaks?)\\s*[：:]\\s*(?:[“"‘「『]|$)`, 'i').test(line);
    if (!direct && !spoken) continue;
    const quote = [line, ...lines.slice(index + 1, index + 4)].join('\n');
    if (/[“"‘「『][^”"’」』\n]{1,240}[”"’」』]/.test(quote)) return text(quote, 360);
  }
  return '';
}

// Compare stored submission facts, not media quality or the current canvas snapshot.
// 只对照该任务实际提交的记录，不把当前画布状态或媒体效果当成历史事实。
export function summarizeCanvasGeneration(task: GenerationTask, calls: GenerationCall[], callsComplete = true): Row {
  const input = task.inputComplete ? object(task.input) : undefined;
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata as Row : {};
  const voices = Array.isArray(metadata.resolvedCharacterVoices) ? metadata.resolvedCharacterVoices.slice(0, 12) : [];
  const taskCalls = calls.filter(call => call.taskId === task.id);
  const creates = taskCalls.filter(call => call.event === 'create' && call.status === 'succeeded'
    && call.providerRequestId && call.providerRequestId === task.providerRequestId);
  const create = creates.length === 1 ? creates[0] : undefined;
  const submitted = create?.inputComplete ? object(create.input) : undefined;
  const content = Array.isArray(submitted?.content) && submitted.content.every(item => item && typeof item === 'object'
    && !Array.isArray(item) && ['text', 'audio_url', 'image_url', 'video_url'].includes(item.type)
    && (item.type !== 'text' || typeof item.text === 'string')) ? submitted.content as Row[] : undefined;
  const aliases = new Map<string, string>();
  let aliasesComplete = true;
  for (const call of taskCalls.filter(item => item.event === 'upload' && item.inputComplete && item.outputComplete && item.status === 'succeeded')) {
    const request = object(call.input), response = object(call.output);
    const resourceId = resourceFromUrl(request?.url);
    const assetId = id(response?.id ?? response?.Id);
    if (!resourceId || !assetId) continue;
    const previous = aliases.get(`asset://${assetId}`);
    if (previous && previous !== resourceId) aliasesComplete = false;
    aliases.set(`asset://${assetId}`, resourceId);
  }
  const references = (content || []).flatMap(item => {
    const kind = item.type === 'audio_url' ? 'audio' : item.type === 'image_url' ? 'image' : item.type === 'video_url' ? 'video' : undefined;
    if (!kind) return [];
    const field = item[`${kind}_url`];
    const url = field && typeof field === 'object' ? (field as Row).url : undefined;
    const resourceId = typeof url === 'string' ? aliases.get(url) || resourceFromUrl(url) : undefined;
    return [{ kind, role: text(item.role, 60), resourceId, resolved: !!resourceId }];
  });
  const submittedText = (content || []).filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n');
  const ready = callsComplete && aliasesComplete && !!input && task.instructionsComplete && !!create && create.inputComplete && !!content
    && references.every(reference => reference.resolved);
  const base = { taskId: task.id, projectId: task.projectId, requestId: task.requestId, traceId: task.traceId,
    occurredAt: new Date(task.occurredAt).toISOString(), source: 'canvas_generation_submission' };
  const submissionLogId = create ? `api_call_logs:${create.id}` : undefined;
  const rows: Row[] = [{ ...base, id: task.id, kind: task.kind, status: task.status, model: task.model,
    providerRequestId: task.providerRequestId, submissionLogId, submissionVerified: ready,
    generateAudio: ready && typeof submitted?.generate_audio === 'boolean' ? submitted.generate_audio : undefined,
    duration: ready && typeof submitted?.duration === 'number' && Number.isFinite(submitted.duration) ? submitted.duration : undefined,
    submittedReferences: ready ? references : undefined, audioCount: ready ? references.filter(reference => reference.kind === 'audio').length : undefined,
    characterVoices: voices.map(value => {
      const voice = value && typeof value === 'object' ? value as Row : {};
      const resourceId = id(voice.sampleResourceId);
      return { characterName: text(voice.characterName, 80), sampleResourceId: resourceId,
        sampleSent: ready && resourceId ? references.some(reference => reference.kind === 'audio' && reference.resourceId === resourceId) : null };
    }),
    mediaQualityVerified: false,
  }];
  for (const value of voices) {
    if (!ready || !value || typeof value !== 'object') continue;
    const voice = value as Row;
    const resourceId = id(voice.sampleResourceId), name = text(voice.characterName, 80);
    if (!resourceId || !name || references.some(reference => reference.kind === 'audio' && reference.resourceId === resourceId)) continue;
    const cue = speechCue(submittedText, name);
    const noticeLine = submittedText.split(/\r?\n/).find(line => line.includes(name) && line.includes(OMITTED_VOICE_NOTICE));
    // A silent actor's configured voice is not an omitted required reference.
    // 只有具名对白和该角色的删样音标记同时存在，才记录已核实的输入冲突；静默角色不报错。
    if (!cue || !noticeLine) continue;
    rows.push({ ...base, id: `${task.id}:voice:${resourceId}`, recordType: 'generation_finding',
      kind: 'character_voice_sample_omitted', findingVerified: true, boundary: 'reference_submission',
      characterName: name, sampleResourceId: resourceId,
      speakingCue: cue, omissionNotice: OMITTED_VOICE_NOTICE, instructionExcerpt: text(noticeLine, 360), submissionLogId,
      message: `该任务给“${name}”配置了声音样本并写有具名对白，但实际供应商创建请求没有包含该样本，且出现“${OMITTED_VOICE_NOTICE}”标记。`,
    });
  }
  return { system: 'canvas', rows, incomplete: !ready,
    sourceTerms: rows.length > 1 ? [OMITTED_VOICE_NOTICE, 'resolvedCharacterVoices'] : [],
    note: ready ? '已对照本人任务绑定与最终供应商创建请求；任务成功不代表音色、口型或画面质量合格。仅确认输入/引用事实，不自动判定成片原因，不读取原始媒体。'
      : '未取得完整且可唯一对应的最终创建请求、引用映射或任务输入；不据此认定样本未发送。仅支持已记录 content 引用的请求格式，不回退其他任务。',
  };
}

async function readGeneration(client: PoolClient, scope: NonNullable<ReturnType<typeof normalizeSupportOperationScope>>) {
  const owner = await supportCanvasUser(client, scope.userId);
  if (!owner) return { system: 'canvas', rows: [], incomplete: true, note: '未取得当前网页登录用户的 active Canvas 受信身份，未读取生成内容。' };
  const result = await client.query<GenerationTask>(`${SUPPORT_CANVAS_OWNED_SCOPE}
    SELECT t.id, t.id AS "taskId", t.project_id AS "projectId", t.request_id AS "requestId", t.trace_id AS "traceId",
           t.provider_request_id AS "providerRequestId", t.status, t.type AS kind, t.model, t.created_at AS "occurredAt",
           left(t.input_json, ${BODY_LIMIT}) AS input, left(t.prompt, ${BODY_LIMIT}) AS instructions,
           length(t.input_json) <= ${BODY_LIMIT} AS "inputComplete", length(t.prompt) <= ${BODY_LIMIT} AS "instructionsComplete"
      FROM tasks t JOIN owned_tasks owned ON owned.id = t.id
     WHERE t.user_id = $1 AND t.id = $2
       AND ($3::text IS NULL OR t.project_id = $3 OR t.project_id IN (SELECT id FROM owned_canvases WHERE project_id = $3))
       AND ($4::timestamptz IS NULL OR t.updated_at >= $4) AND ($5::timestamptz IS NULL OR t.updated_at < $5)
     LIMIT 1`, [owner, scope.taskId, scope.projectId ?? null, scope.from, scope.to]);
  const task = result.rows[0];
  if (!task) return { system: 'canvas', rows: [], note: '当前授权用户及定位范围内没有可读取的生成任务，不扩大到其他账号或项目。' };
  const calls = await client.query<GenerationCall>(`${SUPPORT_CANVAS_OWNED_SCOPE}
    SELECT a.id, a.task_id AS "taskId", a.request_id AS "requestId", a.trace_id AS "traceId",
           a.provider_request_id AS "providerRequestId", a.request_kind AS event, a.status, a.status_code AS "httpStatus",
           left(a.request_body, ${BODY_LIMIT}) AS input, left(a.response_body, ${BODY_LIMIT}) AS output,
           length(a.request_body) <= ${BODY_LIMIT} AS "inputComplete", length(a.response_body) <= ${BODY_LIMIT} AS "outputComplete"
      FROM api_call_logs a JOIN owned_tasks owned ON owned.id = a.task_id
     WHERE a.user_id = $1 AND a.task_id = $2 AND a.request_kind IN ('create', 'upload')
     ORDER BY a.created_at, a.id LIMIT ${CALL_LIMIT + 1}`, [owner, task.id]);
  return summarizeCanvasGeneration(task, calls.rows.slice(0, CALL_LIMIT), calls.rows.length <= CALL_LIMIT);
}

export async function queryCanvasGeneration(input: { userId: string; taskId?: string; projectId?: string; from?: string; to?: string }): Promise<Row> {
  const scope = normalizeSupportOperationScope({ ...input, context: { source: 'canvas' } });
  if (!scope?.taskId || !id(scope.taskId)) return { system: 'canvas', rows: [], error: '生成内容核对必须提供有效的精确任务编号。' };
  if (!process.env.SUPPORT_BOT_CANVAS_DATABASE_URL) return { system: 'canvas', rows: [], incomplete: true, note: 'Canvas 只读数据源未配置，不能核对实际生成内容；不要求用户重复上传素材。' };
  try {
    const result = await withSupportCanvasReadOnly(client => readGeneration(client, scope));
    return { ...result, scope: { taskId: scope.taskId, projectId: scope.projectId, from: scope.from, to: scope.to } };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    return { system: 'canvas', rows: [], incomplete: true, note: ['42P01', '42703', '42501'].includes(code)
      ? '生成内容只读数据源缺少必要表、字段或 SELECT 权限，需管理员补齐后核对；不是用户提示词问题。'
      : '生成内容核对未完成，未据此认定音色、口型或供应商原因。' };
  }
}
