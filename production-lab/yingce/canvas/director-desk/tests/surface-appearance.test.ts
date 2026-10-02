import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { adoptModel } from '../src/resources/model-runtime.ts';
import { SurfaceRuntime } from '../src/media/surface-runtime.ts';
import { defaultSurfaceLayer } from '../src/media/model.ts';
import { createScene } from '../src/scenes.ts';
import { entity } from '../src/model.ts';

test('imported appearance switches preserve surface layers, live parameters and their new base material', () => {
    const root = new T.Group();
    root.add(new T.Mesh(new T.BoxGeometry(), [new T.MeshStandardMaterial({ color:'#ff0000', roughness:.85 }), new T.MeshStandardMaterial({color:'#00ff00', roughness:.7})]));
    const source = adoptModel({scene:root,scenes:[root],cameras:[],animations:[]}, '', []), instance = source.instantiate();
    const mesh = instance.root.children[0].children[0] as T.Mesh;
    const p = createScene('blank'), e = entity('prop', 'cube', 'surface'); p.entities=[e];
    p.media=[{id:'media-'+'a'.repeat(64),name:'image',mime:'image/png',data:'data:image/png;base64,YQ==',width:1,height:1,duration:0}];
    e.surface={layers:[defaultSurfaceLayer(p.media[0].id)],roughness:.1,opacity:.6};
    const surfaces = new SurfaceRuntime(()=>{}), models = new Map([[e.id,instance.root]]);
    const texture = new T.CanvasTexture({width:1,height:1} as HTMLCanvasElement);
    surfaces.textures.sample=()=>texture;
    const actual = () => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as T.MeshStandardMaterial[];
    let released=0, previous:T.Material[]=[];
    try {
        for (const mode of ['original','white','color','original'] as const) {
            instance.setAppearance(mode,'#123456'); surfaces.sample(p,models,0);
            assert.equal(released, previous.length);
            for (const m of actual()) {
                assert.equal(m.roughness,.1); assert.equal(m.opacity,.6);
                assert.ok(m.customProgramCacheKey().startsWith('surface-v1:'));
                if (mode==='white') assert.equal(m.color.getHexString(),'d9dcd7');
                if (mode==='color') assert.equal(m.color.getHexString(),'123456');
            }
            previous=actual(); released=0; previous.forEach(m=>m.addEventListener('dispose',()=>released++));
            const stable=mesh.material; surfaces.sample(p,models,1); assert.equal(mesh.material,stable);
        }
        delete e.surface; surfaces.sample(p,models,2);
        assert.deepEqual(actual().map(m=>m.roughness),[.85,.7]);
        assert.deepEqual(actual().map(m=>m.color.getHexString()),['ff0000','00ff00']);
        e.surface={layers:[],roughness:.2}; surfaces.sample(p,models,2);
        instance.setAppearance('white'); delete e.surface; surfaces.sample(p,models,2);
        assert.equal(actual()[0].color.getHexString(),'d9dcd7','cleanup must not restore the superseded original appearance');
    } finally { surfaces.dispose(); texture.dispose(); source.dispose(); }
});
