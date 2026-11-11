import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDepthVideo, DEFAULT_DEPTH_VIDEO, suggestDepthRange } from '../src/cinematography/depth-video.ts';
import { assertProject } from '../src/model.ts';
import { createScene } from '../src/scenes.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { readSceneDocument, projectForScene } from '../src/scenes/sequence-project.ts';
import { SceneWorkspace } from '../src/scenes/scene-workspace.ts';
import { planVideoExports } from '../src/exporting/plan.ts';

test('depth range rejects invalid distances and flags; legacy scenes remain valid', () => {
    assertProject(createScene('blank'));
    for (const patch of [{near:-1},{far:0},{near:30},{far:Infinity},{far:2001},{near:NaN},{invert:1},{enabled:'true'},{unexpected:1},{curve:0},{curve:4.01},{curve:NaN},{curve:"2"}])
        assert.throws(() => assertDepthVideo({...DEFAULT_DEPTH_VIDEO,...patch}));
    assertDepthVideo({...DEFAULT_DEPTH_VIDEO,near:0,far:2000,enabled:true});
});
test('depth edits roundtrip through multi-scene files, undo and redo', () => {
    let p=createScene('blank'); const history=new SceneWorkspace(p,()=>({time:0,preview:'program',selected:p.entities[0].id}));
    history.begin(p);
    p=applyOperations(p,[{operation:'project',patch:{depthVideo:{enabled:true,near:2,far:40,invert:true,curve:2}}}]);
    history.commit(p);
    const document=readSceneDocument(JSON.parse(JSON.stringify(history.document())));
    assert.deepEqual(projectForScene(document).depthVideo,p.depthVideo);
    const changed=p.depthVideo;p=history.undo(p)!;assert.equal(p.depthVideo,undefined);
    p=history.redo(p)!;assert.deepEqual(p.depthVideo,changed);
});
test('normal exports remain normal; depth batch carries an independent fixed range per job', () => {
    const scenes=[{id:'one',name:'One',duration:2,fps:24,aspect:'16:9' as const},{id:'two',name:'Two',duration:3,fps:30,aspect:'9:16' as const}];
    const selections=scenes.map(s=>({sceneId:s.id,filename:s.name}));
    const settings={size:640,fps:'scene' as const,format:'mp4' as const,monochrome:false};
    assert.ok(planVideoExports(scenes,selections,settings).every(j=>j.options.depth===undefined));
    const depth={near:1,far:20,invert:true,curve:2},jobs=planVideoExports(scenes,selections,{...settings,depth});
    assert.deepEqual(jobs.map(j=>j.options.depth),[depth,depth]);
    jobs[0].options.depth!.far=50;assert.equal(jobs[1].options.depth!.far,20);assert.equal(depth.far,20);
    assert.deepEqual(jobs.map(j=>j.options.fps),[24,30]);
    assert.throws(()=>planVideoExports(scenes,selections,{...settings,depth:{...depth,near:20}}));
});

test('sampled range ignores background/outliers, pads flat surfaces and rejects empty views', () => {
    const values = Array.from({length:1000}, (_, i) => 5 + i / 1000);
    const range = suggestDepthRange([...values, NaN, Infinity, -2, 0, 2000, 1999]);
    assert.ok(range.near < 5.1 && range.near > 4.8);
    assert.ok(range.far > 5.9 && range.far < 6.2);
    const flat = suggestDepthRange([5, 5, 5]);
    assert.ok(flat.near < 5 && flat.far > 5);
    assert.throws(() => suggestDepthRange([0, NaN, 2000]));
    for (const curve of [.25, 1, 4]) assertDepthVideo({...DEFAULT_DEPTH_VIDEO, curve});
});
