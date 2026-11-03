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
  const status = git(['status', '--porcelain', '--untracked-files=all', '--', '.', '../backend/agent-runtime/pi']);
  const rawCommit = process.env.YINGCE_AGENT_BUILD_COMMIT?.trim() || head || 'unknown';
  const commit = /^[a-f0-9]{7,40}$/i.test(rawCommit) ? rawCommit.toLowerCase() : 'unknown';
  const rawDirty = process.env.YINGCE_AGENT_BUILD_DIRTY;
  const dirty = status !== undefined ? rawDirty === 'true' || status !== '' || !!(head && !head.startsWith(commit))
    : rawDirty === 'true' ? true : rawDirty === 'false' ? false : null;
  const safe = value => typeof value === 'string' && /^[\w.+:/ -]{1,100}$/.test(value) ? value : 'unknown';
  return Object.freeze({ service: 'yingce-agent', startedAt: new Date().toISOString(), build: Object.freeze({
    version: safe(process.env.YINGCE_AGENT_BUILD_VERSION?.trim() || 'dev'), commit,
    buildTime: safe(process.env.YINGCE_AGENT_BUILD_TIME?.trim()),
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development', dirty,
  }) });
}

// Capture before requests start; agent runtime code is included in the dirty check.
// 请求开始前固定快照，dirty 检查同时覆盖 Agent runtime 源码。
export const agentRuntimeVersion = capture();
export function sendAgentRuntimeVersion(response) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(agentRuntimeVersion));
}
