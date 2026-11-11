import { randomUUID } from 'node:crypto';

const route = '/api/fg/canvas/prompt-shortcuts';
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const maxShortcuts = 100;
const maxBodyBytes = 32 * 1024;

export async function initializeCanvasPromptShortcuts(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS fg_canvas_prompt_shortcuts (
        user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        shortcuts jsonb NOT NULL DEFAULT '[]'
    )`);
}

async function readShortcut(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > maxBodyBytes) {
            req.resume();
            return null;
        }
        chunks.push(chunk);
    }
    let input;
    try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        return null;
    }
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
    if (!name || name.length > 60 || !prompt || prompt.length > 2000) return null;
    return { name, prompt };
}

export async function canvasPromptShortcutsRoute(req, res, { pool, actor, path }) {
    if (path.pathname !== route && !path.pathname.startsWith(`${route}/`)) return false;
    const send = (status, data, msg = '', reason) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ code: status === 200 ? 0 : status, data, msg, reason }));
        return true;
    };
    if (!actor?.id) return send(401, null, '请先登录', 'FG_ACCESS_DENIED');

    const id = path.pathname === route ? null : path.pathname.slice(route.length + 1);
    if (id !== null && !idPattern.test(id)) return send(404, null, '快捷句不存在', 'PROMPT_SHORTCUT_NOT_FOUND');
    if (id === null && req.method === 'GET') {
        const { rows } = await pool.query('SELECT shortcuts FROM fg_canvas_prompt_shortcuts WHERE user_id=$1', [actor.id]);
        return send(200, { shortcuts: rows[0]?.shortcuts ?? [] });
    }
    const creating = id === null && req.method === 'POST';
    const editing = id !== null && req.method === 'PATCH';
    const deleting = id !== null && req.method === 'DELETE';
    if (!creating && !editing && !deleting) return send(405, null, '不支持此操作', 'METHOD_NOT_ALLOWED');
    const input = deleting ? null : await readShortcut(req);
    if (!deleting && !input) return send(400, null, '请填写名称（最多 60 字）和快捷句（最多 2000 字）', 'PROMPT_SHORTCUT_INVALID');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (creating) {
            await client.query('INSERT INTO fg_canvas_prompt_shortcuts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [actor.id]);
        }
        const { rows } = await client.query('SELECT shortcuts FROM fg_canvas_prompt_shortcuts WHERE user_id=$1 FOR UPDATE', [actor.id]);
        const shortcuts = rows[0]?.shortcuts ?? [];
        const index = id === null ? -1 : shortcuts.findIndex(shortcut => shortcut.id === id);
        if (!creating && index === -1) {
            await client.query('ROLLBACK');
            return send(404, null, '快捷句不存在，可能已在其他设备删除', 'PROMPT_SHORTCUT_NOT_FOUND');
        }
        if (creating && shortcuts.length >= maxShortcuts) {
            await client.query('ROLLBACK');
            return send(409, null, '最多保存 100 条快捷句，请删除一条后再试', 'PROMPT_SHORTCUT_LIMIT');
        }
        if (creating) shortcuts.unshift({ id: randomUUID(), ...input });
        else if (editing) shortcuts[index] = { id, ...input };
        else shortcuts.splice(index, 1);
        await client.query('UPDATE fg_canvas_prompt_shortcuts SET shortcuts=$2::jsonb WHERE user_id=$1', [actor.id, JSON.stringify(shortcuts)]);
        await client.query('COMMIT');
        return send(200, { shortcuts });
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
