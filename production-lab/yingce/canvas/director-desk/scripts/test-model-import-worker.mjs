import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/tmp/**','**/.local/**']}}});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
try {
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);await page.waitForFunction(()=>window.__director);
    const result=await page.evaluate(async()=>{
        const {packModelFilesAsync,readObjGeometry,modelResourceIdAsync}=await import('/src/resources/model-import-worker.ts');
        const {modelPackageId}=await import('/src/resources/model-package-id.ts');
        const {loadObjModel}=await import('/src/resources/obj-model.ts');
        const {assertResourcePackage}=await import('/src/resources/package-validation.ts');
        const encoder=new TextEncoder(),file=(path,text)=>({path,bytes:encoder.encode(text)});
        const triangle='v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
        const texture=new Uint8Array(await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')).arrayBuffer());
        const pkg=await packModelFilesAsync('s.obj',[file('s.obj','mtllib m.mtl\nusemtl red\n'+triangle),file('m.mtl','newmtl red\nKd 1 0 0\nmap_Kd image.png'),{path:'image.png',bytes:texture}]);
        const loaded=await loadObjModel(pkg),info=loaded.inspection;loaded.dispose();
        // Warm validation must use the worker's checked content. Mutating it must still fail.
        assertResourcePackage('test',pkg);pkg.files[0].path='../outside.png';
        let invalid=false;try{assertResourcePackage('test',pkg);}catch{invalid=true;}
        // Large enough to keep a real worker occupied, without external or private fixtures.
        const large=await packModelFilesAsync('large.obj',[file('large.obj',triangle.repeat(150000))]);
        const identityMatches=await modelResourceIdAsync(large)===await modelPackageId(large);
        let ticks=0;const timer=setInterval(()=>ticks++,16),start=performance.now();
        const geometry=await readObjGeometry(large);clearInterval(timer);
        const elapsed=performance.now()-start;
        const controller=new AbortController(),began=performance.now();
        const pending=readObjGeometry(large,controller.signal);setTimeout(()=>controller.abort(),50);
        let canceled=false;try{await pending;}catch(e){canceled=e.name==='AbortError';}
        const cancelMs=performance.now()-began;
        const packAbort=new AbortController(),packing=packModelFilesAsync('large.obj',[file('large.obj',triangle.repeat(150000))],packAbort.signal);
        setTimeout(()=>packAbort.abort(),20);let packCanceled=false;try{await packing;}catch(e){packCanceled=e.name==='AbortError';}
        const again=await readObjGeometry(await packModelFilesAsync('s.obj',[file('s.obj',triangle)]));
        return {meshes:info.meshes,triangles:info.triangles,invalid,identityMatches,ticks,elapsed,canceled,packCanceled,cancelMs,afterCancel:again.meshes.length,vertices:geometry.meshes[0].attributes.find(a=>a.name==='position').array.length/3};
    });
    assert.equal(result.meshes,1);assert.equal(result.triangles,1);assert.equal(result.vertices,450000);
    assert.ok(result.invalid);assert.ok(result.identityMatches);assert.ok(result.ticks>5,JSON.stringify(result));assert.ok(result.canceled);assert.ok(result.packCanceled);assert.equal(result.afterCancel,1);assert.ok(result.cancelMs<1000);assert.deepEqual(errors,[]);
    await fs.mkdir('tmp/model-performance',{recursive:true});await fs.writeFile('tmp/model-performance/worker-tests.json',JSON.stringify(result,null,2));console.log(result);
} finally {await browser.close();await server.close();}
