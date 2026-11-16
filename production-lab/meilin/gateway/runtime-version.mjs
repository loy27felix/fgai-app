import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
function git(args) {
  try { return execFileSync('git', args, { cwd: directory, timeout: 1500, maxBuffer: 128 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return undefined; }
}

function capture() {
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}']);
  const status = git(['status', '--porcelain', '--untracked-files=all', '--', '.']);
  const rawCommit = process.env.YINGCE_GATEWAY_BUILD_COMMIT?.trim() || head || 'unknown';
  const commit = /^[a-f0-9]{7,40}$/i.test(rawCommit) ? rawCommit.toLowerCase() : 'unknown';
  const rawDirty = process.env.YINGCE_GATEWAY_BUILD_DIRTY;
  const dirty = status !== undefined ? rawDirty === 'true' || status !== '' || !!(head && !head.startsWith(commit))
    : rawDirty === 'true' ? true : rawDirty === 'false' ? false : null;
  const safe = value => typeof value === 'string' && /^[\w.+:/ -]{1,100}$/.test(value) ? value : 'unknown';
  return Object.freeze({ service: 'yingce-gateway', startedAt: new Date().toISOString(), build: Object.freeze({
    version: safe(process.env.YINGCE_GATEWAY_BUILD_VERSION?.trim() || 'dev'), commit,
    buildTime: safe(process.env.YINGCE_GATEWAY_BUILD_TIME?.trim()),
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development', dirty,
  }) });
}

// Capture once at import, not per request: later disk edits are not the running process.
// 仅在加载时采集，后续磁盘改动不代表已经运行的新代码。
export const gatewayRuntimeVersion = capture();
export function sendGatewayRuntimeVersion(response) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(gatewayRuntimeVersion));
}
