import test from 'node:test';
import assert from 'node:assert/strict';
import {publicEntryOrigins, workspaceRequestPath, workspaceEntryURL} from './fg-public-entry.mjs';
const origin = 'https://192.168.0.99:3016';
test('external entry uses only an explicitly configured HTTPS origin', () => {
 const allowed = publicEntryOrigins('https://218.61.196.139:8300/');
 assert.deepEqual(allowed, ['https://218.61.196.139:8300']);
 assert.equal(workspaceEntryURL('218.61.196.139:8300', allowed, origin), '/fg-six/');
 assert.equal(workspaceEntryURL('evil.example', allowed, origin), origin + '/');
 for (const url of ['http://example.com/', 'https://user:secret@example.com/', 'https://example.com/path', 'https://example.com/?secret=x']) assert.throws(() => publicEntryOrigins(url));
});
test('public namespace retains encoded-path, managed-auth and commerce guards', () => {
 assert.equal(workspaceRequestPath('/fg-six/api/auth/login', origin).managedAuth, true);
 assert.equal(workspaceRequestPath('/fg-six/api/admin/payments', origin).commercial, true);
 assert.equal(workspaceRequestPath('/fg-six/api/tasks?after=10', origin).url.href, origin + '/api/tasks?after=10');
 assert.equal(workspaceRequestPath('/fg-sixevil/api/tasks', origin).url.pathname, '/fg-sixevil/api/tasks');
 for (const url of ['/fg-six/api/auth%2flogin', '/fg-six/api/%2561uth/login', 'https://evil.example/fg-six/api/tasks']) assert.throws(() => workspaceRequestPath(url, origin));
});
