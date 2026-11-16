import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProject, clone, clip, demoProject, entity } from '../src/model.ts';
import { ModelRecording } from '../src/editor/model-recording.ts';
import { entityPosition, entityYaw } from '../src/timeline.ts';
import { headingDelta } from '../src/animation/path-heading.ts';
import { recordPositionKey } from '../src/editor/position-keys.ts';
import { setClipRange, splitClip } from '../src/clip-editing.ts';
import { SceneWorkspace } from '../src/scenes/scene-workspace.ts';
import { mergeScene } from '../src/scenes/merge-project.ts';
import { duplicateDocumentScene, projectForScene, readSceneDocument } from '../src/scenes/sequence-project.ts';
import { applyOperations } from '../src/automation/edits.ts';

const nearAngle = (a: number, b: number) => assert.ok(Math.abs(headingDelta(a, b)) < 1e-8, `${a} differs from ${b}`);

test('resuming recording preserves fixed, target and path-facing prefix including completed turn clips', () => {
    for (const face of ['fixed', 'target', 'path'] as const) {
        const project = demoProject(), actor = entity('actor', 'person', 'actor'), target = entity('actor', 'person', 'target');
        actor.face = face; actor.rotation[1] = .4; actor.faceTarget = face === 'target' ? target.id : '';
        actor.path = { smooth: true, points: [{ time: 0, position: [0, 0, 0] }, { time: 2, position: [2, 0, 3] }, { time: 6, position: [4, 0, 0] }] };
        actor.clips = [clip('turn', 0, 1), clip('idle', 1, 6)];
        target.path = { smooth: false, points: [{ time: 0, position: [-4, 0, 4] }, { time: 6, position: [7, 0, -4] }] };
        project.entities.push(actor, target);
        const take = new ModelRecording(actor, 4, 24, 'keep', project);
        for (let frame = 0; frame < 24; frame++) take.advance(new Set(['KeyW']), [0, 0, -1]);
        for (let frame = 0; frame <= 96; frame++) {
            const time = frame / 24;
            assert.ok(entityPosition(actor, time).distanceTo(entityPosition(take.entity, time)) < 1e-8);
            nearAngle(entityYaw(actor, time, project), entityYaw(take.entity, time, project));
        }
        assert.equal(take.entity.face, actor.face); assert.equal(take.entity.faceTarget, actor.faceTarget);
        assert.deepEqual(take.entity.clips, actor.clips);
        project.entities[project.entities.indexOf(actor)] = take.entity; assertProject(project);
    }
});

test('stationary target-facing prefixes retain target movement and newly recorded movement changes heading', () => {
    const project = demoProject(), actor = entity('actor', 'person', 'actor'), target = entity('actor', 'person', 'target');
    actor.face = 'target'; actor.faceTarget = target.id;
    target.path = { smooth: false, points: [{ time: 0, position: [-3, 0, 3] }, { time: 4, position: [3, 0, 3] }] };
    project.entities.push(actor, target);
    assert.throws(() => new ModelRecording(actor, 3, 24, 'auto'), /当前场景对象/);
    const take = new ModelRecording(actor, 3, 24, 'auto', project);
    for (let frame = 0; frame < 24; frame++) take.advance(new Set(['KeyW']), [0, 0, -1]);
    for (let frame = 0; frame <= 72; frame++) nearAngle(entityYaw(actor, frame / 24, project), entityYaw(take.entity, frame / 24, project));
    nearAngle(entityYaw(take.entity, 3.5, project), Math.PI);
    const earlier = clone(take.entity);
    const retake = new ModelRecording(take.entity, 3.5, 24, 'auto', project);
    for (let frame = 0; frame < 24; frame++) retake.advance(new Set(['KeyD']), [0, 0, -1]);
    for (let frame = 0; frame <= 84; frame++) nearAngle(entityYaw(earlier, frame / 24, project), entityYaw(retake.entity, frame / 24, project));
    nearAngle(entityYaw(retake.entity, 4, project), Math.PI / 2);
});

test('heading shares cut, retimed source clocks and survives inserted position keys and continuous paths', () => {
    const project = demoProject(), actor = entity('actor', 'person', 'actor'); project.entities.push(actor);
    actor.face = 'fixed'; actor.rotation[1] = .3;
    actor.path = { smooth: false, points: [{ time: 0, position: [0, 0, 0], heading: 170 * Math.PI / 180 }, { time: 4, position: [4, 0, 0], heading: -170 * Math.PI / 180 }] };
    nearAngle(entityYaw(actor, -1, project), .3 + 170 * Math.PI / 180);
    nearAngle(entityYaw(actor, 20, project), .3 - 170 * Math.PI / 180);
    nearAngle(entityYaw(actor, 2, project), .3 + Math.PI);
    const original = clone(actor);
    const right = splitClip(project, { kind: 'path', entityId: actor.id, index: 0 }, 2);
    setClipRange(project, right, 6, 10);
    nearAngle(entityYaw(actor, 8, project), entityYaw(original, 3, project));
    recordPositionKey(actor, 8, [9, 1, 0], 24);
    nearAngle(entityYaw(actor, 8, project), entityYaw(original, 3, project));
    assert.ok(actor.path.points.every(point => Number.isFinite(point.heading)));
    actor.path.interpolation = 'continuous'; assertProject(project);
    nearAngle(entityYaw(actor, 8, project), entityYaw(original, 3, project));
    // Removing all keys' headings deliberately restores the existing face rule.
    actor.path.points.forEach(point => delete point.heading);
    nearAngle(entityYaw(actor, 8, project), .3);
});

test('heading is shared by automation, file roundtrip, history, scene copy and scene merge', () => {
    let project = demoProject(); const actor = project.entities.find(e => e.kind === 'actor')!;
    const before = clone(actor), history = new SceneWorkspace(project, () => ({ time: 2, selected: actor.id, preview: 'program' }));
    history.begin(project);
    const take = new ModelRecording(actor, 2, 24, 'auto', project);
    for (let frame = 0; frame < 24; frame++) take.advance(new Set(['KeyD']), [0, 0, -1]);
    project.entities[project.entities.indexOf(actor)] = take.entity;
    assertProject(project); history.commit(project);
    assert.deepEqual(history.undo(project)!.entities.find(e => e.id === actor.id), before);
    project = history.redo(project)!;
    const expected = project.entities.find(e => e.id === actor.id)!;
    const loaded = JSON.parse(JSON.stringify(project)); assertProject(loaded);
    nearAngle(entityYaw(loaded.entities.find((e: typeof actor) => e.id === actor.id)!, 2.5, loaded), entityYaw(expected, 2.5, project));
    const patched = applyOperations(project, [{ operation: 'update', id: actor.id, patch: { path: clone(expected.path) } }]); assertProject(patched);
    const copied = duplicateDocumentScene(readSceneDocument(patched), 'scene-main', 'copy', 'copy');
    const copiedProject = projectForScene(copied, 'copy');
    nearAngle(entityYaw(copiedProject.entities.find(e => e.id === actor.id)!, 2.5, copiedProject), entityYaw(expected, 2.5, project));
    const merged = mergeScene(demoProject(), project, { offset: [3, 2, 1], timeOffset: 5, scheduling: 'keep', cuts: 'keep' });
    nearAngle(entityYaw(merged.project.entities.find(e => e.id === merged.entityIds[actor.id])!, 7.5, merged.project), entityYaw(expected, 2.5, project));
    const reset = mergeScene(demoProject(), project, { offset: [3, 2, 1], timeOffset: 0, scheduling: 'reset', cuts: 'keep' });
    nearAngle(entityYaw(reset.project.entities.find(e => e.id === reset.entityIds[actor.id])!, 0, reset.project), entityYaw(expected, 0, project));
});

test('reject partial/nonfinite/unsupported heading data without changing legacy paths', () => {
    const project = demoProject(), actor = project.entities.find(e => e.path)!;
    assertProject(project);
    actor.path!.points[0].heading = 0; assert.throws(() => assertProject(project), /heading/);
    actor.path!.points.forEach(point => point.heading = 0); assertProject(project);
    actor.path!.points[0].heading = Infinity; assert.throws(() => assertProject(project), /heading/);
    const camera = project.entities.find(e => e.camera)!;
    delete actor.path!.points[0].heading; actor.path!.points.forEach(point => delete point.heading);
    camera.path = { smooth: false, points: [{ time: 0, position: [0, 1, 0], heading: 0 }] };
    assert.throws(() => assertProject(project), /heading/);
});

test('reset scheduling freezes recorded heading even if the retained face rule targets another actor', () => {
    const project = demoProject(), actor = project.entities.find(e => e.kind === 'actor')!;
    actor.face = 'target'; actor.faceTarget = project.entities.find(e => e.kind === 'actor' && e.id !== actor.id)!.id;
    actor.path = { smooth: false, points: [{ time: 0, position: [...actor.position], heading: .73 }] };
    const expected = entityYaw(actor, 0, project);
    const merged = mergeScene(demoProject(), project, { offset: [10, 3, 5], timeOffset: 0, scheduling: 'reset', cuts: 'keep' });
    const result = merged.project.entities.find(e => e.id === merged.entityIds[actor.id])!;
    assert.equal(result.path, null); assert.equal(result.face, 'fixed'); assert.equal(result.faceTarget, '');
    nearAngle(entityYaw(result, 0, merged.project), expected);
});
