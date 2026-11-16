import { SUPPORT_CANVAS_OWNED_SCOPE, supportCanvasUser, supportOperationErrorEvidence, withSupportCanvasReadOnly } from './operations';
import { projectSupportPayload, SUPPORT_PAYLOAD_LIMIT, type PayloadSelection } from './payload';

type Row = Record<string, unknown>;
export type CanvasDetailSelection = PayloadSelection & { section?: 'input' | 'request' | 'response' };

// Only records already returned by an authorized reader reach this function; recheck ownership in the same read-only snapshot.
// 仅处理授权查询已返回的记录，并在同一只读快照中重新核验归属，缓存命中不能替代当前权限检查。
export async function queryCanvasSupportDetail(userId: string, known: Row, selection: CanvasDetailSelection = {}, projectId?: string): Promise<Row> {
  const call = typeof known.id === 'string' && known.id.startsWith('api_call_logs:')
    && ['api_call_logs', 'canvas_generation_audit'].includes(String(known.source));
  const task = typeof known.id === 'string' && ['canvas_task', 'canvas_generation_submission'].includes(String(known.source)) && known.id === known.taskId;
  if (!call && !task) return { ...known, incomplete: true, parameterCoverage: 'not_available',
    note: '此记录只有任务事件/状态元数据，没有可读取的请求响应正文；未把缓存元数据当作完整参数。' };
  if (selection.section && !(task ? ['input', 'response'] : ['request', 'response']).includes(selection.section)) throw new Error('该记录不支持所选参数方向');
  if ((selection.pointer !== undefined || selection.offset !== undefined) && !selection.section) throw new Error('参数分页需要明确 section');
  const recordId = call ? String(known.id).slice('api_call_logs:'.length) : String(known.id);
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(recordId)) throw new Error('记录编号无效');
  const unavailable = (reason: string): Row => ({ system: 'canvas', rows: [], incomplete: true, reason, requestedRecordId: known.id, parameterCoverage: 'unavailable',
    note: '未取得该记录的授权参数详情；数据源、字段或归属不可用，不扩大范围或回退主站。' });
  if (!process.env.SUPPORT_BOT_CANVAS_DATABASE_URL) return unavailable('canvas_source_unavailable');
  try {
    return await withSupportCanvasReadOnly(async client => {
      const owner = await supportCanvasUser(client, userId);
      if (!owner) return unavailable('authenticated_mapping_unavailable');
      const input = task ? 't.input_json' : 'a.request_body';
      const output = task ? 't.result_json' : 'a.response_body';
      const result = await client.query<Row>(`${SUPPORT_CANVAS_OWNED_SCOPE}
        SELECT ${task ? 't.id' : 'a.task_id'} AS "taskId", t.project_id AS "projectId",
               ${task ? 't' : 'a'}.request_id AS "requestId", ${task ? 't' : 'a'}.trace_id AS "traceId",
               ${task ? 't' : 'a'}.status, ${task ? 'NULL' : 'a.status_code'} AS "httpStatus",
               left(${task ? 't' : 'a'}.error, 2000) AS error,
               left(${input}, ${SUPPORT_PAYLOAD_LIMIT}) AS input,
               left(${output}, ${SUPPORT_PAYLOAD_LIMIT}) AS output,
               length(${input}) <= ${SUPPORT_PAYLOAD_LIMIT} AS "inputComplete",
               length(${output}) <= ${SUPPORT_PAYLOAD_LIMIT} AS "outputComplete"
          FROM ${task ? 'tasks t JOIN owned_tasks owned ON owned.id = t.id' : 'api_call_logs a LEFT JOIN owned_tasks t ON t.id = a.task_id'}
         WHERE ${task ? 't' : 'a'}.user_id = $1 AND ${task ? 't' : 'a'}.id = $2
           ${task ? '' : "AND (nullif(a.task_id, '') IS NULL OR t.id IS NOT NULL)"}
           AND ($3::text IS NULL OR t.project_id = $3 OR t.project_id IN (SELECT id FROM owned_canvases WHERE project_id = $3))
         LIMIT 1`, [owner, recordId, projectId || known.projectId || null]);
      const row = result.rows[0];
      if (!row) return unavailable('record_not_available_in_owned_scope');
      if (['taskId', 'projectId', 'requestId', 'traceId'].some(key => known[key] && known[key] !== row[key])) return unavailable('record_correlation_changed');
      const first = task ? 'input' : 'request';
      const selected = selection.section;
      const exchange = {
        ...(!selected || selected === first ? { [first]: projectSupportPayload(row.input, row.inputComplete === true, selection) } : {}),
        ...(!selected || selected === 'response' ? { response: projectSupportPayload(row.output, row.outputComplete === true, selection) } : {}),
      };
      const parts = Object.values(exchange);
      const metadata = Object.fromEntries(['id', 'source', 'taskId', 'projectId', 'requestId', 'traceId', 'providerRequestId', 'event', 'kind', 'model', 'occurredAt'].map(key => [key, known[key]]));
      const error = supportOperationErrorEvidence(row.error);
      return { ...metadata, taskId: row.taskId, requestId: row.requestId, traceId: row.traceId, projectId: row.projectId,
        status: row.status, httpStatus: row.httpStatus, error: error.summary, errorExcerpt: error.errorExcerpt,
        system: 'canvas', parameterCoverage: 'queried', parameterKind: task ? 'task_snapshot' : 'call_audit', exchange,
        incomplete: parts.some(part => part.state !== 'available' || part.truncated), truncated: parts.some(part => part.truncated),
        note: task ? '本人任务保存的输入/结果快照，不是发送给供应商的请求/原始回执；需与同任务 api_call_logs 及实现分别对照。'
          : '本人调用审计中实际保存的请求/回执参数投影，不是网络抓包；采集时省略的内容无法还原。敏感字段与媒体被移除；可按 section、JSON Pointer 和 nextOffset 继续读取。' };
    });
  } catch {
    return unavailable('parameter_query_failed');
  }
}
