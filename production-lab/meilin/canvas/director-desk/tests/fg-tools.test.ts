import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolService } from '../src/automation/service.ts';
import { demoProject, clone } from '../src/model.ts';
import type { AppContext } from '../src/app-context.ts';

test('FG uses the native tool transaction to edit, reject stale writes and read Skill resources', async () => {
    const state = {
        project: demoProject(), revision: 1, time: 0, busy: false, playing: false,
        history: { pending: false, undoStack: [], redoStack: [] },
        engine: { exporting: false, externalModels: { retain() {}, assertReady() {} } },
        updateTimeUI() {},
        change(update: () => void) {
            state.history.undoStack.push(clone(state.project) as never);
            update(); state.revision++; return true;
        },
    };
    const ctx = state as unknown as AppContext;
    const service = createToolService(ctx);
    const read = await service.call('director_read', { sections: ['entities', 'selection'] });
    assert.equal(read.ok, true);
    const revision = (read.data as { revision: number }).revision;
    const edited = await service.call('director_apply', { revision, requestId: 'fg-offline-edit', operations: [
        { operation: 'add', asset: 'woman', id: 'fg-actor', name: '测试人物', position: [1, 0, 2] },
        { operation: 'add', asset: 'camera', id: 'fg-camera', patch: { camera: { focal: 50, targetId: 'fg-actor' } } },
    ] });
    assert.equal(edited.ok, true, edited.error ?? 'native edit failed');
    assert.equal(ctx.project.entities.find(e => e.id === 'fg-camera')?.camera?.targetId, 'fg-actor');
    assert.equal(ctx.history.undoStack.length, 1);
    const previous = JSON.stringify(ctx.project);
    const stale = await service.call('director_apply', { revision, requestId: 'fg-stale', operations: [
        { operation: 'update', id: 'fg-actor', patch: { name: '不应写入' } },
    ] });
    assert.equal(stale.ok, false);
    assert.match(stale.error!, /REVISION_CONFLICT/);
    assert.equal(JSON.stringify(ctx.project), previous);
    const skill = await service.call('director_skill', { path: 'references/editing.md' });
    assert.equal(skill.ok, true);
    assert.match((skill.data as { instructions: string }).instructions, /revision/);
});
