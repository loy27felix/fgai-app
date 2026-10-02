import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const directory='tmp/depth-particles';await fs.mkdir(directory,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/tmp/**','**/.local/**']}}});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);await page.waitForFunction(()=>window.__director);
    const results=await page.evaluate(async()=>{
        const T=await import('/node_modules/.vite/deps/three.js');
        const {makeVisual,sampleVisual}=await import('/src/visuals/runtime.ts'),{sampleParticleFields}=await import('/src/visuals/fields.ts');
        const {entity}=await import('/src/model.ts'),{ShotEffects}=await import('/src/cinematography/shot-effects.ts'),{DepthRangeSampler}=await import('/src/cinematography/depth-range-sampler.ts');
        const r=new T.WebGLRenderer({preserveDrawingBuffer:true});r.setSize(256,256);
        const s=new T.Scene(),c=new T.PerspectiveCamera(50,1,.025,2000),fx=new ShotEffects(),sampler=new DepthRangeSampler();
        s.background=new T.Color(0);c.position.set(0,0,8);c.lookAt(0,0,0);c.updateMatrixWorld(true);
        const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');
        const pixels=()=>{ctx.drawImage(r.domElement,0,0);return ctx.getImageData(0,0,256,256).data;};
        const changed=(a,b)=>a.reduce((n,v,i)=>n+(v!==b[i]),0),visible=a=>a.reduce((n,v,i)=>n+(i%4!==3&&v>0),0);
        const output=[];
        try {
            for (const preset of ['snow','smoke','fire','helix']) {
                const e=entity('prop','visual-'+preset,preset),root=makeVisual(e),source=root.children[0].material;s.add(root);
                const draw=(time,depth=null)=>{sampleVisual(e,root,time,false);fx.render(r,s,c,undefined,time,5,()=>{},[],depth);return pixels();};
                const color0=draw(0),color2=draw(2),range={near:.1,far:15,invert:false,curve:1};
                const depth0=draw(0,range),depth2=draw(2,range),frame=r.domElement.toDataURL();
                const fitted=sampler.sample(r,s,c),restored=root.children[0].material===source&&s.overrideMaterial===null;
                const repeated=draw(0,range),normalAgain=draw(0);
                e.visual.opacity=0;const hidden=draw(2,range);
                output.push({preset,colorChanged:changed(color0,color2),depthChanged:changed(depth0,depth2),depthVisible:visible(depth2),repeatChanged:changed(depth0,repeated),normalChanged:changed(color0,normalAgain),hiddenVisible:visible(hidden),fitted,restored,frame});
                root.removeFromParent();root.children[0].geometry.dispose();source.dispose();
            }
            const e=entity('prop','visual-snow','field-particles'),field=entity('prop','field-wind','wind');
            field.field.radius=100;field.field.strength=1;field.field.targets=[e.id];
            const root=makeVisual(e),fieldRoot=new T.Group(),models=new Map([[e.id,root],[field.id,fieldRoot]]);s.add(root);
            sampleVisual(e,root,2,false);
            const before=sampler.sample(r,s,c);
            sampleParticleFields([e,field],models,2);
            const after=sampler.sample(r,s,c);
            output.push({preset:'field',before,after});
            root.removeFromParent();root.children[0].geometry.dispose();root.children[0].material.dispose();
        } finally { sampler.dispose();fx.dispose();r.dispose(); }
        return output;
    });
    for(const result of results){
        if(result.preset==='field'){assert.ok(result.after.far<result.before.far-1,JSON.stringify(result));continue;}
        assert.ok(result.depthVisible>0&&result.depthChanged>0,JSON.stringify(result));
        assert.equal(result.repeatChanged,0);assert.equal(result.normalChanged,0);assert.equal(result.hiddenVisible,0);assert.ok(result.restored&&result.fitted.samples>0);
        await fs.writeFile(`${directory}/${result.preset}.png`,Buffer.from(result.frame.split(',')[1],'base64'));delete result.frame;
    }
    assert.deepEqual(errors,[]);
    await fs.writeFile(`${directory}/results.json`,JSON.stringify({results,errors},null,2));
    console.log(JSON.stringify({results,errors},null,2));
} finally { await browser.close();await server.close(); }
