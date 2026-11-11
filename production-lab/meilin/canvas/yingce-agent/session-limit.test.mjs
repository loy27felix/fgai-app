import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

test('Agent admits a configured limit of 100 and rejects out of range updates', async () => {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const token = 'test-only-credential-'.repeat(3);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(port), MAX_CONCURRENT_SESSIONS: '100', YINGCE_AGENT_TOKEN: token },
    stdio: 'pipe',
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { response = await fetch(`http://127.0.0.1:${port}/healthz`); break; } catch {}
      if (child.exitCode !== null) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(response, output);
    assert.equal((await response.json()).limit, 100);
    for (const limit of [100, 101, 0, 1.5]) {
      const result = await fetch(`http://127.0.0.1:${port}/v1/limit`, {
        method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ maxSessions: limit }),
      });
      assert.equal(result.status, limit === 100 ? 200 : 400);
      if (limit === 100) assert.equal((await result.json()).limit, 100);
    }
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
});
