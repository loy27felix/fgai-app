import type { LogCategory, LogDetail, LogRecord } from '@/lib/observability/log-search-contract';

export const CATEGORY_LABELS: Record<LogCategory, string> = {
  browser: '浏览器日志',
  api: 'API 日志',
  api_runtime: 'API 运行日志',
  infrastructure: '基建日志',
  other: '其他来源',
};

export function categoryLabel(category: LogCategory) {
  return CATEGORY_LABELS[category] || '其他来源';
}

export function statusText(row: LogRecord) {
  if (row.httpStatus === null) return 'HTTP —';
  return `HTTP ${row.httpStatus}`;
}

export function rowSummary(row: LogRecord) {
  if (row.category === 'api') return `${row.route || row.event} · ${statusText(row)}${row.durationMs === null ? '' : ` · ${row.durationMs} ms`}`;
  if (row.category === 'browser') return row.message || `${row.service} · ${row.event}`;
  if (row.category === 'infrastructure') return `${row.service} · ${row.message || row.event}`;
  return row.message || `${row.service} · ${row.event}`;
}

function text(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function detailFields(detail: LogDetail) {
  const request = detail.details.request && typeof detail.details.request === 'object' ? detail.details.request as Record<string, unknown> : {};
  const fields: Array<[string, string]> = [
    ['类别', categoryLabel(detail.category)],
    ['来源', detail.source],
    ['服务', detail.service],
    ['事件', detail.event],
    ['级别', detail.level],
    ['结果', detail.outcome],
    ['时间', detail.occurredAt],
    ['Trace ID', detail.traceId || '—'],
    ['Request ID', detail.requestId || '—'],
    ['Task ID', detail.taskId || '—'],
    ['用户 ID', detail.userId || '—'],
    ['操作者', detail.actorEmail || '—'],
    ['路由', detail.route || '—'],
    ['HTTP 状态', detail.httpStatus === null ? '—' : String(detail.httpStatus)],
    ['耗时', detail.durationMs === null ? '—' : `${detail.durationMs} ms`],
  ];
  if (detail.category === 'browser') fields.push(['浏览器上下文', text(detail.details.browser || detail.details.userAgent || detail.details.page)]);
  if (detail.category === 'api') fields.push(['HTTP 方法', text(detail.details.method || request.method)]);
  if (detail.category === 'infrastructure') fields.push(['主机/组件', text(detail.details.host || detail.details.component || detail.service)]);
  return fields;
}

export function jsonText(detail: LogDetail) {
  return JSON.stringify(detail.details, null, 2) || '{}';
}

export type DetailHeader = { name: string; value: string };
export type DetailBody = {
  value: unknown;
  encoding: string | null;
  bytes: number | null;
  truncated: boolean;
  capture: 'content' | 'empty' | 'binary' | 'unavailable';
};
export type ExchangeSide = {
  method: string | null;
  url: string | null;
  status: string | null;
  statusText: string | null;
  headers: DetailHeader[];
  headersCaptured: boolean;
  body: DetailBody | null;
};
export type ExchangeError = {
  name: string | null;
  message: string | null;
  code: string | null;
  status: string | null;
  retryable: string | null;
  cause: unknown;
  stack: string | null;
};
export type DetailContextField = { key: string; label: string; value: unknown };
export type FormattedExchange = {
  exchangeId: string | null;
  stage: string | null;
  request: ExchangeSide | null;
  response: ExchangeSide | null;
  error: ExchangeError | null;
  context: DetailContextField[];
};
export type DetailSection = {
  id: 'request' | 'response' | 'error' | 'context';
  title: string;
  exchange?: ExchangeSide;
  error?: ExchangeError;
  fields?: DetailContextField[];
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function hasOwn(value: UnknownRecord | null, key: string) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== '';
}

function firstValue(...values: unknown[]) {
  return values.find(hasValue);
}

function ownValue(value: UnknownRecord | null, keys: string[]) {
  for (const key of keys) {
    if (hasOwn(value, key)) return value?.[key];
  }
  return undefined;
}

function ownValueOrFallback(value: UnknownRecord | null, keys: string[], fallback: unknown) {
  return keys.some((key) => hasOwn(value, key)) ? ownValue(value, keys) : fallback;
}

function scalar(value: unknown) {
  if (!hasValue(value)) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return text(value);
}

function headers(value: unknown): DetailHeader[] {
  const values = record(value);
  if (!values) return [];
  return Object.entries(values)
    .map(([name, headerValue]) => ({ name, value: scalar(headerValue) || '—' }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function body(value: unknown, encoding: unknown, bytes: unknown, truncated: unknown, captured: boolean): DetailBody | null {
  if (!captured) return null;
  const byteCount = typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : null;
  const bodyEncoding = scalar(encoding);
  return {
    value,
    encoding: bodyEncoding,
    bytes: byteCount,
    truncated: truncated === true,
    capture: bodyEncoding === 'unavailable' ? 'unavailable' : bodyEncoding === 'binary' ? 'binary' : bodyEncoding === 'empty' || value === null ? 'empty' : 'content',
  };
}

function exchangeSide(input: {
  request?: UnknownRecord | null;
  response?: UnknownRecord | null;
  method?: unknown;
  url?: unknown;
  status?: unknown;
  statusText?: unknown;
  headers?: unknown;
  body?: unknown;
  encoding?: unknown;
  bytes?: unknown;
  truncated?: unknown;
  evidence?: boolean;
  headersCaptured?: boolean;
  bodyCaptured?: boolean;
}): ExchangeSide | null {
  const hasSideData = input.evidence ?? [input.request, input.response, input.method, input.url, input.status, input.statusText, input.headers, input.body, input.encoding, input.bytes, input.truncated].some((value) => value !== undefined && value !== null);
  if (!hasSideData) return null;
  const side = input.request || input.response || {};
  const nestedHeadersCaptured = hasOwn(side, 'headers');
  const nestedBodyCaptured = hasOwn(side, 'body') || hasOwn(side, 'bodyText') || hasOwn(side, 'encoding') || hasOwn(side, 'bodyEncoding') || hasOwn(side, 'bytes') || hasOwn(side, 'truncated');
  return {
    method: scalar(firstValue(side.method, input.method)),
    url: scalar(firstValue(side.url, input.url)),
    status: scalar(firstValue(side.status, side.statusCode, input.status)),
    statusText: scalar(firstValue(side.statusText, input.statusText)),
    headers: headers(nestedHeadersCaptured ? side.headers : input.headers),
    headersCaptured: nestedHeadersCaptured || input.headersCaptured === true,
    body: body(
      ownValueOrFallback(side, ['body', 'bodyText'], input.body),
      firstValue(side.bodyEncoding, side.encoding, input.encoding),
      firstValue(side.bytes, input.bytes),
      firstValue(side.truncated, input.truncated),
      nestedBodyCaptured || input.bodyCaptured === true,
    ),
  };
}

/**
 * Normalise browser's nested exchange and Provider's top-level response fields.
 * 统一浏览器嵌套 exchange 与 Provider 顶层响应字段，渲染层无需猜测日志来源。
 */
export function formatExchange(detail: LogDetail): FormattedExchange {
  const details = detail.details;
  const request = record(details.request);
  const response = record(details.response);
  const errorRecord = record(details.error);
  const requestEvidence = request !== null || hasOwn(details, 'method') || hasOwn(details, 'url') || hasOwn(details, 'path') || hasOwn(details, 'requestUrl') || hasOwn(details, 'requestHeaders') || hasOwn(details, 'requestBody') || hasOwn(details, 'requestBodyText') || hasOwn(details, 'requestBodyEncoding') || hasOwn(details, 'requestBytes') || hasOwn(details, 'requestTruncated');
  const responseEvidence = response !== null || hasOwn(details, 'responseHeaders') || hasOwn(details, 'responseBody') || hasOwn(details, 'responseBodyText') || hasOwn(details, 'responseBodyEncoding') || hasOwn(details, 'responseBytes') || hasOwn(details, 'responseTruncated');
  const requestSide = exchangeSide({
    request,
    method: details.method,
    url: firstValue(details.requestUrl, details.url, details.path, detail.route),
    headers: details.requestHeaders,
    body: ownValue(details, ['requestBodyText', 'requestBody']),
    encoding: details.requestBodyEncoding,
    bytes: details.requestBytes,
    truncated: details.requestTruncated,
    evidence: requestEvidence,
    headersCaptured: hasOwn(details, 'requestHeaders'),
    bodyCaptured: hasOwn(details, 'requestBody') || hasOwn(details, 'requestBodyText') || hasOwn(details, 'requestBodyEncoding') || hasOwn(details, 'requestBytes') || hasOwn(details, 'requestTruncated'),
  });
  const responseSide = exchangeSide({
    response,
    status: firstValue(details.responseStatus, details.httpStatus, detail.httpStatus),
    statusText: details.responseStatusText,
    headers: details.responseHeaders,
    body: ownValue(details, ['responseBodyText', 'responseBody']),
    encoding: details.responseBodyEncoding,
    bytes: details.responseBytes,
    truncated: details.responseTruncated,
    evidence: responseEvidence,
    headersCaptured: hasOwn(details, 'responseHeaders'),
    bodyCaptured: hasOwn(details, 'responseBody') || hasOwn(details, 'responseBodyText') || hasOwn(details, 'responseBodyEncoding') || hasOwn(details, 'responseBytes') || hasOwn(details, 'responseTruncated'),
  });
  const topLevelErrorPresent = errorRecord === null && ['code', 'message', 'name', 'status', 'stack', 'providerCode', 'retryable', 'cause'].some((key) => hasOwn(details, key));
  const error = errorRecord || topLevelErrorPresent || hasValue(details.error) || hasValue(details.causeName) || hasValue(details.causeCode) || hasValue(details.causeMessage)
    ? {
      name: scalar(firstValue(errorRecord?.name, errorRecord ? undefined : details.name, details.causeName)),
      message: scalar(firstValue(errorRecord?.message, errorRecord ? undefined : details.message, topLevelErrorPresent ? detail.message : undefined, details.causeMessage, errorRecord ? undefined : details.error)),
      code: scalar(firstValue(errorRecord?.code, errorRecord?.providerCode, errorRecord ? undefined : details.code, errorRecord ? undefined : details.providerCode, details.causeCode)),
      status: scalar(firstValue(errorRecord?.status, errorRecord ? undefined : details.status)),
      retryable: scalar(firstValue(errorRecord?.retryable, errorRecord ? undefined : details.retryable)),
      cause: firstValue(errorRecord?.cause, errorRecord ? undefined : details.cause),
      stack: scalar(firstValue(errorRecord?.stack, errorRecord ? undefined : details.stack)),
    }
    : null;
  const contextInputs: Array<[string, string, unknown]> = [
    ['stage', '阶段', details.stage],
    ['operation', '操作', details.operation],
    ['provider', '供应商', details.provider],
    ['feature', '功能', details.feature],
    ['exchangeId', 'Exchange ID', details.exchangeId],
    ['pageRoute', '页面路由', details.pageRoute],
    ['userAgent', 'User-Agent', details.userAgent],
    ['host', '主机', details.host],
    ['origin', 'Origin', details.origin],
    ['forwardedHost', '转发主机', details.forwardedHost],
    ['forwardedPort', '转发端口', details.forwardedPort],
    ['forwardedProto', '转发协议', details.forwardedProto],
    ['contentType', 'Content-Type', details.contentType],
    ['cfRay', 'CF-Ray', details.cfRay],
    ['parameters', '请求参数', details.parameters],
    ['data', '业务数据', details.data],
    ['metadata', '附加元数据', details.metadata],
    ['eventKey', '事件键', details.eventKey],
    ['checkName', '检查项', details.checkName],
    ['state', '当前状态', details.state],
    ['previousState', '前一状态', details.previousState],
    ['containerId', '容器 ID', details.containerId],
    ['deploymentVersion', '部署版本', details.deploymentVersion],
  ];
  const context: DetailContextField[] = contextInputs
    .filter(([, , value]) => hasValue(value))
    .map(([key, label, value]) => ({ key, label, value }));
  if (requestSide && requestSide.headersCaptured && requestSide.headers.length === 0) {
    context.push({ key: 'requestHeadersCapture', label: '请求 Headers', value: '已采集，空对象' });
  }
  if (responseSide && responseSide.headersCaptured && responseSide.headers.length === 0) {
    context.push({ key: 'responseHeadersCapture', label: '响应 Headers', value: '已采集，空对象' });
  }
  const responseStatus = firstValue(details.responseStatus, details.httpStatus, detail.httpStatus);
  if (!responseSide && hasValue(responseStatus)) {
    context.push({ key: 'responseStatus', label: '响应状态', value: responseStatus });
  }
  for (const [side, label] of [[requestSide, '请求'], [responseSide, '响应']] as const) {
    if (!side?.body || side.body.capture === 'content') continue;
    const captureLabel = side.body.capture === 'empty' ? '已采集空 Body' : side.body.capture === 'binary' ? '已识别二进制 Body，内容未展示' : 'Body 读取不可用';
    context.push({ key: `${label}BodyCapture`, label: `${label} Body 状态`, value: captureLabel });
  }
  if (exchangeIdPresent(details) && requestSide && !responseSide) {
    context.push({ key: 'exchangeCoverage', label: 'Exchange 记录', value: '当前条仅记录请求阶段；响应会作为相同 Exchange ID 的另一条日志保存。' });
  }
  if (exchangeIdPresent(details) && responseSide && !requestSide) {
    context.push({ key: 'exchangeCoverage', label: 'Exchange 记录', value: '当前条仅记录响应阶段；请求通常位于相同 Exchange ID 的另一条日志。' });
  }

  return {
    exchangeId: scalar(details.exchangeId),
    stage: scalar(details.stage),
    request: requestSide,
    response: responseSide,
    error,
    context,
  };
}

function exchangeIdPresent(details: UnknownRecord) {
  return hasValue(details.exchangeId);
}

export function detailSections(detail: LogDetail): DetailSection[] {
  const exchange = formatExchange(detail);
  const sections: DetailSection[] = [];
  if (exchange.request) sections.push({ id: 'request', title: '请求参数', exchange: exchange.request });
  if (exchange.response) sections.push({ id: 'response', title: '响应', exchange: exchange.response });
  if (exchange.error) sections.push({ id: 'error', title: '错误', error: exchange.error });
  if (exchange.context.length) sections.push({ id: 'context', title: '业务上下文', fields: exchange.context });
  return sections;
}
