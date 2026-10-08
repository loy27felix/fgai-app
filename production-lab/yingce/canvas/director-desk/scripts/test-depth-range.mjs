import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const directory='tmp/depth-contrast';await fs.mkdir(directory,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/tmp/**','**/.local/**']}}});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);await page.waitForFunction(()=>window.__director);
 const probe=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{ShotEffects}=await import('/src/cinematography/shot-effects.ts'),{DepthRangeSampler}=await import('/src/cinematography/depth-range-sampler.ts');
  const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(256,256);
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,1,.025,2000),effects=new ShotEffects(),sampler=new DepthRangeSampler();
  scene.background=new T.Color('#ff0000');renderer.setClearColor('#123456',.7);
  const material=new T.MeshBasicMaterial({color:'white'}),plane=new T.Mesh(new T.PlaneGeometry(100,100),material);scene.add(plane);
  const pixel=()=>{const c=document.createElement('canvas');c.width=256;c.height=256;const x=c.getContext('2d');x.drawImage(renderer.domElement,0,0);return x.getImageData(128,128,1,1).data[0];};
  const depths=[];
  for(const z of [2,6,10]){plane.position.z=-z;const range=sampler.sample(renderer,scene,camera);depths.push(range);if(Math.abs((range.near+range.far)/2-z)>.015)throw Error('sample distance wrong '+JSON.stringify(range));}
  plane.position.z=-6;const levels=[];
  for(const curve of [1,2,.5,4,1]){effects.render(renderer,scene,camera,undefined,0,5,()=>{},[],{near:2,far:10,invert:false,curve});levels.push(pixel());}
  effects.render(renderer,scene,camera,undefined,0,5,()=>{},[],{near:2,far:10,invert:true,curve:2});const inverted=pixel();
  scene.remove(plane);const sphere=new T.Mesh(new T.SphereGeometry(.6,64,32),material);sphere.position.z=-5;scene.add(sphere);
  const fitted=sampler.sample(renderer,scene,camera),images=[];
  for(const range of [{near:.1,far:30,invert:false},{...fitted,invert:false,curve:1.25}]){effects.render(renderer,scene,camera,undefined,0,5,()=>{},[],range);images.push(renderer.domElement.toDataURL());}
  const restored=scene.overrideMaterial===null&&scene.background.getHexString()==='ff0000'&&renderer.getClearColor(new T.Color()).getHexString()==='123456'&&renderer.getClearAlpha()===.7;
  sphere.visible=false;let empty=false;try{sampler.sample(renderer,scene,camera);}catch{empty=true;}
  sampler.dispose();effects.dispose();plane.geometry.dispose();sphere.geometry.dispose();material.dispose();renderer.dispose();
  return {depths,levels,inverted,fitted,restored,empty,images};
 });
 assert.ok(probe.restored&&probe.empty);
 for(const [i,value] of [128,64,180,16,128].entries())assert.ok(Math.abs(probe.levels[i]-value)<=2,JSON.stringify(probe.levels));
 assert.ok(Math.abs(probe.inverted-191)<=2);
 for(const [i,name] of ['sphere-before','sphere-after'].entries())await fs.writeFile(`${directory}/${name}.png`,Buffer.from(probe.images[i].split(',')[1],'base64'));
 delete probe.images;
 const state=await page.evaluate(async()=>{
  const {createScene}=await import('/src/scenes.ts'),{entity}=await import('/src/model.ts');
  const api=window.__director,p=createScene('blank');p.duration=3;
  const actor=entity('actor','human-adult','主体',[0,0,0]);actor.id='depth-subject';p.entities.push(actor);
  const c=p.entities.find(e=>e.camera);c.position=[0,1.4,5];c.camera.aim='target';c.camera.target=[0,1,0];c.camera.focal=50;
  p.depthVideo={enabled:true,near:.1,far:30,invert:false,curve:1};api.replaceProject(p);
  const call=async(name,args)=>{const r=await api.callTool(name,args);if(!r.ok)throw Error(r.error);return r.data;};
  await call('director_view',{time:1,cameraId:c.id,entityId:actor.id});
  const e=api.getEngine();await e.prepareOutput(1);const before=e.renderOutput(1,640,360,c.id).toDataURL(),original=JSON.stringify(api.getProject());
  const range=await call('director_spatial',{time:1.5,cameraId:c.id,ids:[actor.id],depthRange:true});
  const after=e.renderOutput(1,640,360,c.id).toDataURL();e.restorePreview(1);
  if(before!==after||original!==JSON.stringify(api.getProject())||range.applied!==false)throw Error('query changed scene');
  const rejected=await api.callTool('director_spatial',{depthRange:true,ids:['missing']});if(rejected.ok)throw Error('missing subject accepted');
  return {range,cameraId:c.id};
 });
 await page.screenshot({path:`${directory}/actor-before.png`});
 await page.locator('[data-depth-fit="selection"]').click();
 await page.locator('[data-depth="curve"]').fill('1.5');await page.locator('[data-depth="curve"]').press('Tab');
 const settings=await page.evaluate(()=>window.__director.getProject().depthVideo);
 assert.ok(settings.far-settings.near<2,JSON.stringify(settings));assert.equal(settings.curve,1.5);
 await page.screenshot({path:`${directory}/actor-after.png`});
 await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>window.__director.getProject().depthVideo.curve),1);
 await page.keyboard.press('Control+Shift+z');assert.equal(await page.evaluate(()=>window.__director.getProject().depthVideo.curve),1.5);
 await page.locator('.header-actions [data-act="export"]').click();await page.waitForTimeout(250);
 assert.equal(await page.locator('#export-depth-curve').inputValue(),'1.5');
 await page.locator('[data-export-depth-fit="frame"]').click();await page.waitForTimeout(250);
 assert.ok(Number(await page.locator('#export-depth-far').inputValue())>settings.far);
 await page.locator('#export-depth-near').fill('50');await page.locator('#export-depth-near').press('Tab');
 assert.ok(await page.locator('[data-act="export-start"]').isDisabled());
 await page.locator('[data-export-depth-fit="selection"]').click();await page.waitForTimeout(250);
 assert.ok(await page.locator('[data-act="export-start"]').isEnabled());
 await page.locator('#export-depth-curve').fill('2');await page.locator('#export-depth-curve').press('Tab');await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>window.__director.getProject().depthVideo.curve),1.5);
 const layout=await page.locator('.modal-body').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight}));
 assert.ok(layout.scrollHeight<=layout.height+1&&layout.scrollWidth<=layout.width+1,JSON.stringify(layout));
 await page.screenshot({path:`${directory}/export.png`});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({probe,state,settings,layout,errors},null,2));
}finally{await browser.close();await server.close();}
