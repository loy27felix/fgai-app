import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { canvasPromptShortcutsRoute } from './fg-canvas-prompt-shortcuts.mjs';

const base = '/api/fg/canvas/prompt-shortcuts';

function fixture() {
    const records = new Map();
    async function query(sql, [accountId, shortcuts] = []) {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return {};
        assert.match(sql, /fg_canvas_prompt_shortcuts/);
        assert.ok(accountId);
        if (sql.startsWith('SELECT')) {
            return { rows: records.has(accountId) ? [{ shortcuts: structuredClone(records.get(accountId)) }] : [] };
        }
        if (sql.startsWith('INSERT')) {
            if (!records.has(accountId)) records.set(accountId, []);
            return {};
        }
        assert.match(sql, /^UPDATE .* WHERE user_id=\$1$/);
        records.set(accountId, JSON.parse(shortcuts));
        return {};
    }
    const pool = { query, connect: async () => ({ query, release() {} }) };

    return async (actorId, method, pathname = base, input) => {
        const req = Readable.from(input === undefined ? [] : [Buffer.from(JSON.stringify(input))]);
        req.method = method;
        let status;
        let body;
        const res = {
            writeHead(code) { status = code; },
            end(value) { body = JSON.parse(value); },
        };
        assert.equal(await canvasPromptShortcutsRoute(req, res, { pool, actor: actorId ? { id: actorId } : null, path: { pathname } }), true);
        return { status, body };
    };
}

test('快捷句按登录账号保存、读取、编辑与删除', async () => {
    const request = fixture();
    const created = await request('owner', 'POST', base, { user_id: 'other', name: ' 只要音效 ', prompt: ' 不要 BGM 和字幕，只要音效 ' });
    assert.equal(created.status, 200);
    const [shortcut] = created.body.data.shortcuts;
    assert.deepEqual(shortcut, { id: shortcut.id, name: '只要音效', prompt: '不要 BGM 和字幕，只要音效' });
    assert.deepEqual((await request('owner', 'GET')).body.data.shortcuts, [shortcut]);
    assert.deepEqual((await request('other', 'GET')).body.data.shortcuts, []);
    const path = `${base}/${shortcut.id}`;
    assert.equal((await request('other', 'PATCH', path, { name: '试改', prompt: '其他内容' })).status, 404);
    assert.equal((await request('other', 'DELETE', path)).status, 404);
    assert.deepEqual((await request('owner', 'GET')).body.data.shortcuts, [shortcut]);
    assert.equal((await request('owner', 'PATCH', path, { name: '只要音效', prompt: '保留现场音效。' })).status, 200);
    assert.deepEqual((await request('owner', 'GET')).body.data.shortcuts, [{ ...shortcut, prompt: '保留现场音效。' }]);
    assert.equal((await request('owner', 'DELETE', path)).status, 200);
    assert.deepEqual((await request('owner', 'GET')).body.data.shortcuts, []);
});

test('快捷句拒绝未登录、空正文和超长请求', async () => {
    const request = fixture();
    assert.equal((await request(null, 'GET')).status, 401);
    assert.equal((await request('owner', 'POST', base, { name: '空正文', prompt: ' ' })).status, 400);
    assert.equal((await request('owner', 'POST', base, { name: '超长', prompt: '字'.repeat(2001) })).status, 400);
    assert.equal((await request('owner', 'POST', base, { name: '请求太大', prompt: '字'.repeat(12000) })).status, 400);
    assert.deepEqual((await request('owner', 'GET')).body.data.shortcuts, []);
});
