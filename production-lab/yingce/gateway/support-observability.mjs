import { randomUUID } from 'node:crypto';
import { gatewayRuntimeVersion } from './runtime-version.mjs';

const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : undefined;

export function observeSupportRequest(req, res) {
  const started = Date.now();
  const requestId = identifier(req.headers['x-request-id']) || randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);
  const observation = { userId: undefined, route: undefined, errorCode: undefined };
  let recorded = false;
  const complete = () => {
    if (recorded) return;
    recorded = true;
    // Identity is assigned only after platformActor authenticates the FG session.
    // 身份只在 platformActor 验证 FG 会话后写入，不采信客户端用户Header。
    if (!identifier(observation.userId)) return;
    const status = res.writableFinished ? res.statusCode : 499;
    console.log(JSON.stringify({ event: 'support_http_request', service: 'yingce-gateway',
      build_commit: gatewayRuntimeVersion.build.commit, build_version: gatewayRuntimeVersion.build.version, build_dirty: gatewayRuntimeVersion.build.dirty,
      build_environment: gatewayRuntimeVersion.build.environment,
      time: new Date().toISOString(), level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      fg_user_id: observation.userId, request_id: identifier(res.getHeader('x-request-id')) || requestId,
      trace_id: identifier(res.getHeader('x-canvas-trace-id')),
      method: req.method, route: observation.route, status, latency_ms: Date.now() - started,
      ...(observation.errorCode ? { error_code: observation.errorCode } : {}) }));
  };
  res.once('finish', complete);
  res.once('close', complete);
  res.supportObservation = observation;
  return observation;
}

export function safeSupportRoute(path) {
  // No query strings, share capabilities or arbitrary user-supplied path fragments.
  // 不记录查询参数、分享凭据或任意用户输入的路径片段。
  const staticSegments = new Set(['api', 'fg', 'entry', 'auth', 'session', 'admin', 'system', 'version', 'health',
    'projects', 'project', 'tasks', 'task', 'dramas', 'episodes', 'canvases', 'canvas', 'storyboards', 'storyboard',
    'generate', 'status', 'retry', 'cancel', 'run', 'runs', 'logs', 'events', 'settings', 'appearance', 'users',
    'models', 'channels', 'assets', 'media', 'music', 'speech', 'create', 'update', 'delete', 'list',
    'fg-music', 'fg-speech', 'fg-adcraft', 'fg-meilin', 'fg-inspiration', 'fg-creator', 'fg-budget']);
  return path.split('/').map(segment => staticSegments.has(segment) ? segment : segment ? ':id' : '').join('/').slice(0, 250);
}
