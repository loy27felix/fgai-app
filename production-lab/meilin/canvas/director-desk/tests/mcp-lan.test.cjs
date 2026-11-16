const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startLanProxy, DEFAULT_LAN_PORT } = require('../desktop/mcp-lan-proxy.cjs');
const { createMcpHost } = require('../desktop/mcp-host.cjs');
const { getLanIPv4 } = require('../desktop/mcp-lan-proxy.cjs');

const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: s => Buffer.from(s.split('').reverse().join('')),
    decryptString: b => b.toString().split('').reverse().join('')
};

// Reserve isolated ports instead of assuming the user's default LAN port is unused.
function listen(server, port = 0) {
    return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); server.off('error', failed); server.off('listening', ready); };
        const failed = error => { cleanup(); reject(error); };
        const ready = () => { cleanup(); resolve(server.address().port); };
        const timer = setTimeout(() => { cleanup(); server.close(); reject(Error('Test listener timed out')); }, 3000);
        server.once('error', failed); server.once('listening', ready);
        server.listen(port, '0.0.0.0');
    });
}
async function close(server) {
    server.closeAllConnections();
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Test server cleanup timed out')), 3000);
        server.close(error => { clearTimeout(timer); error ? reject(error) : resolve(); });
    });
}
async function reservePorts(count) {
    for (let attempt = 0; attempt < 30; attempt++) {
        const servers = [];
        try {
            const first = http.createServer(); servers.push(first);
            const port = await listen(first);
            if (port + count > 65535 || port <= DEFAULT_LAN_PORT && port + count > DEFAULT_LAN_PORT) {
                await close(first); continue;
            }
            for (let index = 1; index < count; index++) {
                const next = http.createServer(); servers.push(next); await listen(next, port + index);
            }
            return { port, servers };
        } catch (error) {
            await Promise.all(servers.map(close));
            if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
        }
    }
    throw Error('Could not reserve isolated consecutive test ports');
}

test('getLanIPv4 returns a valid IPv4 string', () => {
    const ip = getLanIPv4();
    assert.match(ip, /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
});

test('MCP host LAN toggle, configuration generation, and proxy forwarding', { timeout: 15000 }, async () => {
    const reserved = await reservePorts(1);
    await close(reserved.servers[0]);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'director-mcp-lan-'));
    const dummyTools = [{ name: 'dummy_tool', description: 'test dummy', inputSchema: { type: 'object' } }];
    const host = createMcpHost({
        directory,
        safeStorage,
        definitions: dummyTools,
        call: async () => ({ ok: true }),
        version: '1.0.0',
        lanProxyPort: reserved.port
    });

    try {
        // Initially cannot enable LAN if MCP is off
        await assert.rejects(host.lan(true), /请先开启/);

        // Turn on MCP
        const initial = await host.change(true);
        assert.equal(initial.enabled, true);
        assert.equal(Boolean(initial.lanEnabled), false);

        // Turn on LAN proxy
        const lanState = await host.lan(true);
        assert.equal(lanState.enabled, true);
        assert.equal(lanState.lanEnabled, true);
        assert(typeof lanState.lanUrl === 'string');
        assert(lanState.lanUrl.startsWith('http://'));
        assert(lanState.lanUrl.endsWith('/mcp'));
        assert(lanState.lanPort >= reserved.port && lanState.lanPort < reserved.port + 100);

        // Local connection config
        const localConn = (await host.connection('http', { useLan: false })).mcpServers['director-desk'];
        assert(localConn.url.includes('127.0.0.1'));

        // LAN connection config
        const lanConn = (await host.connection('http', { useLan: true })).mcpServers['director-desk'];
        assert.equal(lanConn.url, lanState.lanUrl);
        assert.deepEqual(lanConn.headers, localConn.headers);

        // Claude Code LAN config
        const claudeCodeLan = (await host.connection('claude-code', { useLan: true })).mcpServers['director-desk'];
        assert.equal(claudeCodeLan.type, 'http');
        assert.equal(claudeCodeLan.url, lanState.lanUrl);

        // Exercise the LAN listener via loopback; interface selection/WiFi routing varies by machine.
        const proxyUrl = `http://127.0.0.1:${lanState.lanPort}/mcp`;
        const res = await fetch(proxyUrl, {
            signal: AbortSignal.timeout(3000),
            method: 'POST',
            headers: {
                ...lanConn.headers,
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                connection: 'close'
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.result?.tools?.[0]?.name, 'dummy_tool');

        // Turn off LAN proxy
        const offState = await host.lan(false);
        assert.equal(offState.enabled, true);
        assert.equal(Boolean(offState.lanEnabled), false);

        // Proxy port should now be closed / unreachable
        await assert.rejects(fetch(proxyUrl, {
            signal: AbortSignal.timeout(3000),
            method: 'POST',
            headers: {
                ...lanConn.headers,
                'content-type': 'application/json',
                connection: 'close'
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
        }));

        // Turn on LAN proxy again, then turn off MCP completely
        await host.lan(true);
        const stopped = await host.change(false);
        assert.equal(stopped.enabled, false);
        assert.equal(Boolean(stopped.lanEnabled), false);
    } finally {
        await host.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('startLanProxy increments past occupied consecutive ports', { timeout: 15000 }, async () => {
    const target = http.createServer((req, res) => res.writeHead(200).end());
    let reserved, proxy;
    try {
        const targetPort = await listen(target);
        reserved = await reservePorts(3);
        // Keep two blockers alive, releasing only the expected destination.
        await close(reserved.servers[2]);
        proxy = await startLanProxy({ targetPort, proxyPort: reserved.port });
        assert.equal(proxy.port, reserved.port + 2);
        const response = await fetch(`http://127.0.0.1:${proxy.port}/mcp`, {
            method: 'POST', signal: AbortSignal.timeout(3000), headers: { connection: 'close' }, body: '{}',
        });
        assert.equal(response.status, 200); await response.text();
    } finally {
        await proxy?.close();
        await Promise.all([...(reserved?.servers ?? []), target].map(close));
    }
});
