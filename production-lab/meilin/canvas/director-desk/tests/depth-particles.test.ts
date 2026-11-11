import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { DepthVideoMaterial } from '../src/cinematography/depth-video-material.ts';
import { entity } from '../src/model.ts';
import { makeVisual, sampleVisual } from '../src/visuals/runtime.ts';

test('particle depth retains vertex motion and live uniforms, restores on failure and releases variants', () => {
    const e=entity('prop','visual-snow','snow'),root=makeVisual(e),scene=new T.Scene();scene.add(root);
    const points=root.children[0] as T.Points<T.BufferGeometry,T.ShaderMaterial>, original=points.material;
    const display=new DepthVideoMaterial(), sampling=new DepthVideoMaterial(true);
    let variant:T.ShaderMaterial|undefined, released=0;
    display.setRange({near:2,far:15,invert:true,curve:2});sampleVisual(e,root,2,false);
    try {
        display.withParticles(scene,()=>{
            variant=points.material;
            assert.equal(variant.vertexShader,original.vertexShader);
            assert.equal(variant.uniforms.clock,original.uniforms.clock);
            assert.equal(variant.uniforms.fieldCenters,original.uniforms.fieldCenters);
            assert.equal(variant.uniforms.displayNear.value,2);
            assert.equal(variant.uniforms.displayInvert.value,true);
            assert.equal(variant.allowOverride,false);assert.equal(variant.depthWrite,true);
            variant.addEventListener('dispose',()=>released++);
        });
        assert.equal(points.material,original);
        assert.throws(()=>display.withParticles(scene,()=>{assert.equal(points.material,variant);throw Error('renderer failure');}),/renderer failure/);
        assert.equal(points.material,original);
        sampling.withParticles(scene,()=>{assert.notEqual(points.material,variant);assert.equal(points.material.uniforms.clock,original.uniforms.clock);});
        assert.equal(points.material,original);
        original.dispose();assert.equal(released,1);
        display.dispose();assert.equal(released,1,'source disposal already released its variant');
    } finally { display.dispose();sampling.dispose();original.dispose();points.geometry.dispose(); }
});
