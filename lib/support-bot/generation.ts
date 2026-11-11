import type { PoolClient } from 'pg';
import { normalizeSupportOperationScope, SUPPORT_CANVAS_OWNED_SCOPE, supportCanvasUser, supportOperationErrorEvidence, withSupportCanvasReadOnly } from './operations';
import { redactSupportText } from './redact';

const BODY_LIMIT = 65536;
const CALL_LIMIT = 64;
const REFERENCE_LIMIT = 32;
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
  model?: string; format?: string; operation?: string; error?: string; occurredAt?: string | Date;
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
export type GenerationResource = {
  id: string; status: string; mimeType: string; bytes: number | string; width: number; height: number; updatedAt: string | Date;
};
function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
function taskReferences(input: Row | undefined): { kind: string; value: Row; index: number }[] {
  return [['image', 'referenceImages'], ['audio', 'referenceAudios'], ['video', 'referenceVideos'], ['mask', 'mask']].flatMap(([kind, key]) => {
    const values = key === 'mask' ? input?.mask ? [input.mask] : [] : Array.isArray(input?.[key]) ? input[key] : [];
    return values.slice(0, REFERENCE_LIMIT).map((value: unknown, index: number) => ({ kind, index: index + 1,
      value: value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {} }));
  }).slice(0, REFERENCE_LIMIT);
}
function referenceResource(value: Row): string | undefined {
  return typeof value.storageKey === 'string' && value.storageKey.startsWith('resource:')
    ? id(value.storageKey.slice(9)) : resourceFromUrl(value.url);
}
function requestFacts(call: GenerationCall): Row {
  const request = call.inputComplete ? object(call.input) : undefined;
  if (!request) return {};
  const settings: Row = {};
  for (const key of ['model', 'size', 'quality', 'n', 'count', 'aspect_ratio', 'resolution', 'duration', 'generate_audio', 'watermark', 'response_format']) {
    const value = request[key];
    if (typeof value === 'string') settings[key] = text(value, 120);
    else if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) settings[key] = value;
  }
  const messages = [request.content, ...(Array.isArray(request.messages) ? request.messages.map(message => message?.content) : []),
    ...(Array.isArray(request.contents) ? request.contents.map(content => content?.parts) : [])];
  const blocks = messages.flatMap(value => Array.isArray(value) ? value : []);
  const excerpts = [request.prompt, request.instructions, ...messages.filter(value => typeof value === 'string'), ...blocks.map(block => block?.text)].filter(value => typeof value === 'string');
  const media = blocks.flatMap<Row>(block => {
    if (!block || typeof block !== 'object') return [];
    const inline = block.inlineData || block.inline_data;
    if (inline && typeof inline === 'object') {
      const mimeType = text(inline.mimeType || inline.mime_type, 80);
      return [{ kind: mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'image' : 'unknown',
        location: 'inline', mimeType, inlineEncodingRecorded: typeof inline.data === 'string',
        encodingCharsInAudit: typeof inline.data === 'string' ? inline.data.length : undefined }];
    }
    const kind = block.type === 'image_url' ? 'image' : block.type === 'audio_url' ? 'audio' : block.type === 'video_url' ? 'video' : undefined;
    if (!kind) return [];
    const field = block[`${kind}_url`];
    const url = typeof field === 'string' ? field : field?.url;
    return [{ kind, resourceId: resourceFromUrl(url), location: typeof url !== 'string' ? 'unknown'
      : url.startsWith('asset://') ? 'provider_asset' : url.startsWith('data:') ? 'inline' : /^https?:/.test(url) ? 'url' : 'sanitized',
      role: text(block.role, 80) }];
  });
  let referencesTruncated = false;
  for (const key of ['image', 'images', 'mask']) {
    const entries = Array.isArray(request[key]) ? request[key] : request[key] ? [request[key]] : [];
    if (entries.length > REFERENCE_LIMIT) referencesTruncated = true;
    for (const value of entries.slice(0, REFERENCE_LIMIT)) {
      if (typeof value === 'string') media.push({ kind: key === 'mask' ? 'mask' : 'image', resourceId: resourceFromUrl(value),
        location: value.startsWith('data:') ? 'inline' : /^https?:/.test(value) ? 'url' : 'sanitized' });
      else if (value && typeof value === 'object' && typeof value.fileName === 'string') media.push({ kind: key === 'mask' ? 'mask' : 'image',
        location: 'multipart_audit', label: text(value.fileName, 120), mimeType: text(value.contentType, 80), bytesInAudit: positiveNumber(value.size) });
    }
  }
  return { requestSettings: settings, requestInstructionExcerpt: text(excerpts.join('\n'), 1800),
    requestReferences: media.slice(0, REFERENCE_LIMIT), requestReferencesTruncated: referencesTruncated || media.length > REFERENCE_LIMIT,
    requestFormatRecognized: blocks.length > 0 || excerpts.length > 0 || media.length > 0, requestAuditSanitized: true };
}

function inputFacts(task: GenerationTask, input: Row | undefined, calls: GenerationCall[], resources: GenerationResource[]) {
  const config = input?.config && typeof input.config === 'object' ? input.config as Row : {};
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata as Row : {};
  const plan = metadata.styleExecutionPlan && typeof metadata.styleExecutionPlan === 'object' ? metadata.styleExecutionPlan as Row : {};
  const styleIds = new Set((Array.isArray(plan.assets) ? plan.assets : []).flatMap((asset: unknown) => {
    if (!asset || typeof asset !== 'object') return [];
    const value = asset as Row;
    return value.action === 'reference' && typeof value.assetId === 'string' && value.assetId.startsWith('style-reference:')
      ? [value.assetId.slice(16)] : [];
  }));
  const settings: Row = {};
  for (const key of ['model', 'interfaceType', 'apiFormat', 'count', 'quality', 'size', 'imageResolution',
    'videoSeconds', 'vquality', 'videoGenerateAudio', 'videoWatermark', 'audioVoice', 'audioFormat', 'audioSpeed']) {
    const value = config[key];
    if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) settings[key] = value;
    else if (typeof value === 'string') settings[key] = text(value, 120);
  }
  const counts = Object.fromEntries(['referenceImages', 'referenceAudios', 'referenceVideos'].map(key =>
    [key, input && Array.isArray(input[key]) ? input[key].length : input && input[key] == null ? 0 : null]));
  const references = taskReferences(input).map(({ kind, value, index }) => {
    const resourceId = referenceResource(value);
    const resource = resources.find(row => row.id === resourceId);
    return { id: `${task.id}:${kind}:${index}`, taskId: task.id, recordType: 'generation_reference', source: 'canvas_task_input',
      kind, index, resourceId, label: text(value.name, 120), role: text(value.role, 80),
      origin: resourceId && styleIds.has(resourceId) ? 'project_style_reference' : 'task_reference',
      storedBytes: positiveNumber(value.bytes), storedWidth: positiveNumber(value.width), storedHeight: positiveNumber(value.height),
      hasInlineData: typeof value.dataUrl === 'string' && value.dataUrl.startsWith('data:'),
      resourceSnapshot: resource ? { status: text(resource.status, 40), mimeType: text(resource.mimeType, 120),
        bytes: positiveNumber(resource.bytes), width: positiveNumber(resource.width), height: positiveNumber(resource.height),
        updatedAt: new Date(resource.updatedAt).toISOString() } : undefined,
      physicalFileChecked: false, finalTransmissionVerified: false };
  });
  const audit = calls.filter(call => call.taskId === task.id).map(call => ({
    id: `api_call_logs:${call.id}`, taskId: task.id, recordType: 'generation_call', source: 'canvas_generation_audit',
    requestId: id(call.requestId), traceId: id(call.traceId), providerRequestId: id(call.providerRequestId), event: text(call.event, 60),
    occurredAt: call.occurredAt ? new Date(call.occurredAt).toISOString() : undefined,
    status: call.status, httpStatus: call.httpStatus, model: text(call.model, 120), format: text(call.format, 60), operation: text(call.operation, 80),
    requestRecorded: call.inputComplete && !!object(call.input),
    responseRecorded: call.outputComplete && !!object(call.output), detailAvailable: true,
    recordingIssue: /报文过大|已省略/.test(call.input) ? text(call.input, 160)
      : !call.inputComplete ? '请求审计读取已截断' : !object(call.input) ? '没有可解析的 JSON 请求审计，可能为其他报文格式' : undefined,
    ...(call.event === 'create' ? requestFacts(call) : {}), ...supportOperationErrorEvidence(call.error),
  }));
  const root = 'production-lab/yingce/canvas/backend/internal/app/';
  const implementationChecks = [
    { path: `${root}provider.go`, term: 'func (s *Service) processCanvasGenerationTask', aspect: 'instructions_and_dispatch' },
    { path: `${root}provider_protocol_request.go`, term: 'func protocolRequestFromInput', aspect: 'request_mapping' },
    ...(references.length ? [{ path: `${root}provider_media_hydration.go`, term: 'data, err := io.ReadAll', aspect: 'reference_encoding' }] : []),
    ...(styleIds.size ? [{ path: `${root}provider_style.go`, term: 'func (s *Service) appendStyleReferenceImages', aspect: 'style_references' }] : []),
  ];
  return { summary: { inputFactsAvailable: !!input, mode: text(input?.mode, 40), settings, referenceCounts: counts,
    instructionExcerpt: text(task.instructions, 3500), instructionChars: task.instructions.length,
    instructionsTruncated: !task.instructionsComplete || task.instructions.length > 3500,
    inputInstructionExcerpt: input && typeof input.prompt === 'string' && input.prompt !== task.instructions ? text(input.prompt, 1200) : undefined,
    storedInstructionsMatch: input && typeof input.prompt === 'string' && task.instructionsComplete ? input.prompt === task.instructions : null,
    systemInstructionExcerpt: text(config.systemPrompt, 800), referencesTruncated: Object.values(counts).reduce<number>((sum, count) => sum + Number(count || 0), input?.mask ? 1 : 0) > REFERENCE_LIMIT,
    resourceMetadataOnly: true, finalRequestIndependentOfTaskInput: true }, references, audit, implementationChecks };
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
export function summarizeCanvasGeneration(task: GenerationTask, calls: GenerationCall[], callsComplete = true, resources: GenerationResource[] = [], submissionCallsComplete = callsComplete): Row {
  const input = task.inputComplete ? object(task.input) : undefined;
  const facts = inputFacts(task, input, calls, resources);
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
  const ready = submissionCallsComplete && aliasesComplete && !!input && task.instructionsComplete && !!create && create.inputComplete && !!content
    && references.every(reference => reference.resolved);
  const base = { taskId: task.id, projectId: task.projectId, requestId: task.requestId, traceId: task.traceId,
    occurredAt: new Date(task.occurredAt).toISOString(), source: 'canvas_generation_submission' };
  const submissionLogId = create ? `api_call_logs:${create.id}` : undefined;
  const rows: Row[] = [{ ...base, id: task.id, kind: task.kind, status: task.status, model: task.model,
    providerRequestId: task.providerRequestId, submissionLogId, submissionVerified: ready, ...facts.summary,
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
  rows.push(...facts.references, ...facts.audit);
  return { system: 'canvas', rows, incomplete: !ready || !callsComplete, submissionCoverage: { complete: ready }, auditCoverage: { events: [...new Set(calls.map(call => call.event))], complete: callsComplete, allRecordedEventsQueried: true, selection: 'create/upload优先，其余阶段取最新记录，返回后按发生时间排序；超过上限不代表完整审计', parameterTool: 'detail', limit: CALL_LIMIT }, implementationChecks: facts.implementationChecks,
    sourceTerms: rows.some(row => row.recordType === 'generation_finding') ? [OMITTED_VOICE_NOTICE, 'resolvedCharacterVoices'] : [],
    note: ready ? '已对照本人任务绑定与最终供应商创建请求；任务成功不代表音色、口型或画面质量合格。仅确认输入/引用事实，不自动判定成片原因，不读取原始媒体。'
      : '最终供应商请求未完整核对，但已取得的任务输入、提示词摘录、参考素材清单与调用审计仍分别可用。任务输入不等于最终请求；资源登记大小不等于已读取物理文件或最终发送字节。请逐项核对，不能只复述接口报错，也不能把部分缺失说成全部查不到。',
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
           a.model, a.api_format AS format, a.operation, a.created_at AS "occurredAt", left(a.error, 2000) AS error,
           left(a.request_body, ${BODY_LIMIT}) AS input, left(a.response_body, ${BODY_LIMIT}) AS output,
           length(a.request_body) <= ${BODY_LIMIT} AS "inputComplete", length(a.response_body) <= ${BODY_LIMIT} AS "outputComplete"
      FROM api_call_logs a JOIN owned_tasks owned ON owned.id = a.task_id
     WHERE a.user_id = $1 AND a.task_id = $2
     ORDER BY CASE WHEN a.request_kind IN ('create', 'upload') THEN 0 ELSE 1 END,
       CASE WHEN a.request_kind IN ('create', 'upload') THEN a.created_at END, a.created_at DESC, a.id LIMIT ${CALL_LIMIT + 1}`, [owner, task.id]);
  const input = task.inputComplete ? object(task.input) : undefined;
  const resourceIds = [...new Set(taskReferences(input).map(reference => referenceResource(reference.value)).filter(Boolean))];
  let resources: GenerationResource[] = [];
  let resourceMetadataIssue: string | undefined;
  if (resourceIds.length) {
    await client.query('SAVEPOINT generation_resources');
    try {
      resources = (await client.query<GenerationResource>(`SELECT id, status, mime_type AS "mimeType", size AS bytes,
        width, height, updated_at AS "updatedAt" FROM resources WHERE user_id = $1 AND id = ANY($2::text[]) LIMIT ${REFERENCE_LIMIT}`, [owner, resourceIds])).rows;
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT generation_resources');
      resourceMetadataIssue = '本次资源元数据查询未完成；保留历史任务输入，不能据此认定无素材或文件已删除。';
    }
    await client.query('RELEASE SAVEPOINT generation_resources');
  }
  const complete = calls.rows.length <= CALL_LIMIT;
  const submissionComplete = complete || !['create', 'upload'].includes(calls.rows[CALL_LIMIT].event);
  const audit = calls.rows.slice(0, CALL_LIMIT).sort((a, b) => new Date(a.occurredAt!).getTime() - new Date(b.occurredAt!).getTime());
  const summary = summarizeCanvasGeneration(task, audit, complete, resources, submissionComplete);
  return { ...summary, ...(resourceMetadataIssue ? { resourceMetadataIssue } : {}) };
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
