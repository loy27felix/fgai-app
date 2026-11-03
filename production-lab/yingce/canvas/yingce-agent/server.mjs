import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { agentRuntimeVersion, sendAgentRuntimeVersion } from './runtime-version.mjs';

const token = process.env.YINGCE_AGENT_TOKEN || "";
const maxSessionLimit = 100;
let maxSessions = positiveInt(process.env.MAX_CONCURRENT_SESSIONS, 30, maxSessionLimit);
const memoryMB = positiveInt(process.env.NODE_MAX_OLD_SPACE_SIZE, 512, 8192);
const runtimePath = process.env.YINGCE_AGENT_RUNTIME || "/app/agent-runtime/agent-runtime.mjs";
const port = Number(process.env.PORT || 8081);
const host = process.env.YINGCE_AGENT_HOST?.trim() || "0.0.0.0";
const bodyLimit = 32 * 1024 * 1024;

if (token.length < 32) {
  console.error("YINGCE_AGENT_TOKEN must contain at least 32 characters");
  process.exit(1);
}

let active = 0;
const waiters = [];

function positiveInt(raw, fallback, max) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function authorized(request) {
  const actual = Buffer.from(request.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function acquire(response) {
  if (response.destroyed) return Promise.reject(new Error("Agent request cancelled while queued"));
  if (active < maxSessions) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve: () => {
        response.off("close", abort);
        resolve();
      },
      reject,
    };
    waiters.push(waiter);
    const abort = () => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error("Agent request cancelled while queued"));
    };
    // 请求体正常读完也会 destroyed；排队取消跟随尚未结束的响应连接。
    response.once("close", abort);
  });
}

function admitWaiters() {
  while (waiters.length > 0 && active < maxSessions) {
    active += 1;
    waiters.shift().resolve();
  }
}

function release() {
  if (waiters.length > 0 && active <= maxSessions) {
    waiters.shift().resolve();
    admitWaiters();
    return;
  }
  active = Math.max(0, active - 1);
  admitWaiters();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > bodyLimit) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function writeRuntimeError(response, message) {
  if (!response.headersSent) {
    response.writeHead(200, { "content-type": "application/x-ndjson" });
  }
  response.end(`${JSON.stringify({ event: "runtime_error", message })}\n`);
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health/version') { sendAgentRuntimeVersion(response); return; }
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, active, limit: maxSessions, queued: waiters.length }));
    return;
  }
  if (request.method === "PUT" && request.url === "/v1/limit") {
    if (!authorized(request)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    try {
      const body = JSON.parse((await readBody(request)).toString("utf8"));
      const next = Number(body.maxSessions);
      if (!Number.isInteger(next) || next < 1 || next > maxSessionLimit) {
        throw new Error(`maxSessions must be an integer from 1 to ${maxSessionLimit}`);
      }
      maxSessions = next;
      admitWaiters();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, active, limit: maxSessions, queued: waiters.length }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "invalid limit" }));
    }
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/runs") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (!authorized(request)) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  let body;
  let run;
  try {
    body = await readBody(request);
    run = JSON.parse(body.toString("utf8"));
    if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Error('invalid run object');
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "invalid request" }));
    return;
  }
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : undefined;
  // The caller has passed the internal service token; userId originates in Canvas runtime context.
  // 调用方已通过内部服务Token鉴权，userId来自Canvas运行上下文，不接受匿名客户端自报身份。
  const requestId = safeId(run.runId) || randomUUID();
  response.setHeader('x-request-id', requestId);
  const started = Date.now();
  let failureCode;
  let logged = false;
  const logRun = () => {
    if (logged || !safeId(run.userId)) return;
    logged = true;
    console.log(JSON.stringify({ event: 'support_agent_run', service: 'yingce-agent', time: new Date().toISOString(),
      build_commit: agentRuntimeVersion.build.commit, build_version: agentRuntimeVersion.build.version, build_dirty: agentRuntimeVersion.build.dirty,
      build_environment: agentRuntimeVersion.build.environment,
      user_id: run.userId, request_id: requestId, run_id: safeId(run.runId), session_id: safeId(run.sessionId),
      method: 'POST', route: '/v1/runs', status: response.writableFinished ? response.statusCode : 499,
      outcome: failureCode ? 'failed' : response.writableFinished ? 'completed' : 'cancelled',
      level: failureCode ? 'error' : 'info', error_code: failureCode, latency_ms: Date.now() - started }));
  };
  response.once('finish', logRun);
  response.once('close', logRun);
  try {
    await acquire(response);
  } catch (error) {
    if (response.destroyed) return;
    failureCode = 'AGENT_QUEUE_CANCELLED';
    response.writeHead(499, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "cancelled" }));
    return;
  }
  if (response.destroyed) {
    release();
    return;
  }

  const child = spawn(process.execPath, [`--max-old-space-size=${memoryMB}`, runtimePath], {
    cwd: dirname(runtimePath),
    env: {
      PATH: process.env.PATH || "",
      NODE_ENV: "production",
      PI_OFFLINE: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    release();
  };
  let sawRuntimeError = false;
  const decoder = new StringDecoder('utf8');
  let pendingLine = '';
  let oversizedLine = false;
  const inspectOutput = text => {
    // Parse bounded NDJSON across chunks; never infer failure from quoted user/model content.
    // 跨chunk解析有界NDJSON，不把用户或模型正文中的错误关键字当成运行失败。
    const parts = text.split('\n');
    for (let index = 0; index < parts.length; index++) {
      if (!oversizedLine) pendingLine += parts[index];
      if (pendingLine.length > 64 * 1024) { pendingLine = ''; oversizedLine = true; }
      if (index === parts.length - 1) continue;
      if (!oversizedLine && pendingLine.trim()) {
        try {
          const event = JSON.parse(pendingLine);
          if (['runtime_error', 'bridge_error'].includes(event?.event)) { sawRuntimeError = true; failureCode = 'AGENT_RUNTIME_ERROR'; }
        } catch { /* The runtime owns protocol validation. / 协议校验仍由runtime处理。 */ }
      }
      pendingLine = '';
      oversizedLine = false;
    }
  };
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  response.once("close", stop);
  response.writeHead(200, { "content-type": "application/x-ndjson" });
  child.stdout.on("data", (chunk) => {
    inspectOutput(decoder.write(chunk));
    response.write(chunk);
  });
  child.stdout.on('end', () => inspectOutput(decoder.end() + '\n'));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => {
    failureCode = 'AGENT_SPAWN_FAILED';
    writeRuntimeError(response, error.message);
    finish();
  });
  child.on("close", (code) => {
    if (code) failureCode = 'AGENT_EXIT_NONZERO';
    if (!response.writableEnded) {
      if (code && !sawRuntimeError) {
        response.write(`${JSON.stringify({ event: "runtime_error", message: `Agent runtime exited with code ${code}` })}\n`);
      }
      response.end();
    }
    finish();
  });
  child.stdin.end(body);
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.listen(port, host, () => {
  const address = server.address();
  console.log(`YINGCE_AGENT_READY ${address.port}`);
});
