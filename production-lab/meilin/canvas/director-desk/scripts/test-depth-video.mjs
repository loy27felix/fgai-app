import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {verifyVideoFrames} from './verify-video-frames.mjs';

const directory='tmp/depth-video';await fs.mkdir(directory,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/tmp/**','**/.local/**']}}});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);await page.waitForFunction(()=>window.__director);
 const pixels=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{ShotEffects}=await import('/src/cinematography/shot-effects.ts');
  const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(200,100);renderer.toneMapping=T.ACESFilmicToneMapping;
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,2,.025,2000),effects=new ShotEffects();
  scene.background=new T.Color('#ff0000');const mesh=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshBasicMaterial({color:'#00ff00'}));scene.add(mesh);
  const read=()=>{const c=document.createElement('canvas');c.width=200;c.height=100;const x=c.getContext('2d');x.drawImage(renderer.domElement,0,0);return Array.from(x.getImageData(100,50,1,1).data);};
  const out=[];let labels=0;
  for(const distance of [2,6,10]){mesh.position.z=-distance;effects.render(renderer,scene,camera,undefined,0,5,()=>labels++,[],{near:2,far:10,invert:false});out.push(read());}
  effects.render(renderer,scene,camera,undefined,0,5,()=>labels++,[],{near:2,far:10,invert:true});const inverted=read();
  mesh.visible=false;effects.render(renderer,scene,camera,undefined,0,5,()=>labels++,[],{near:2,far:10,invert:false});const background=read();mesh.visible=true;
  const depthLabels=labels;
  effects.render(renderer,scene,camera,undefined,0,5,()=>labels++);const normal=read();
  const restored=scene.overrideMaterial===null&&scene.background.getHexString()==='ff0000'&&renderer.shadowMap.enabled===false;
  effects.dispose();mesh.geometry.dispose();mesh.material.dispose();renderer.dispose();
  return {out,inverted,background,depthLabels,normal,restored};
 });
 assert.ok(pixels.restored);assert.equal(pixels.depthLabels,0);
 for(let i=0;i<3;i++)for(let c=0;c<3;c++)assert.ok(Math.abs(pixels.out[i][c]-[255,128,0][i])<=2,JSON.stringify(pixels));
 assert.equal(pixels.background[0],0);assert.equal(pixels.inverted[0],255);assert.ok(pixels.normal[1]>pixels.normal[0]+50);
 const antialias=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{ShotEffects}=await import('/src/cinematography/shot-effects.ts');
  const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(256,256);renderer.toneMapping=T.ACESFilmicToneMapping;
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,1,.025,2000),effects=new ShotEffects();
  const mesh=new T.Mesh(new T.PlaneGeometry(1.2,1.2),new T.MeshBasicMaterial());mesh.position.z=-2;mesh.rotation.z=.33;scene.add(mesh);
  const read=()=>{const c=document.createElement('canvas');c.width=256;c.height=256;const x=c.getContext('2d');x.drawImage(renderer.domElement,0,0);return {pixels:x.getImageData(0,0,256,256).data,image:c.toDataURL()};};
  effects.render(renderer,scene,camera,undefined,0,5,()=>{},[],{near:2,far:10,invert:false});const improved=read();
  // Reproduce the former post-resolve raw-depth mapping on the same geometry/target.
  const legacyMaterial=new T.ShaderMaterial({uniforms:{depthMap:{value:effects.target.depthTexture}},vertexShader:'varying vec2 uvOut;void main(){uvOut=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D depthMap;varying vec2 uvOut;void main(){float d=texture2D(depthMap,uvOut).x;float z=.025*2000./(2000.-(2000.-.025)*d);float gray=d>=1.?0.:1.-clamp((z-2.)/8.,0.,1.);gl_FragColor=vec4(vec3(gray),1.);}'});
  const quad=new T.Mesh(new T.PlaneGeometry(2,2),legacyMaterial),quadScene=new T.Scene();quadScene.add(quad);renderer.render(quadScene,new T.OrthographicCamera(-1,1,1,-1,0,1));const legacy=read();
  effects.render(renderer,scene,camera,undefined,0,5,()=>{},[],{near:2,far:10,invert:true});const inverted=read();
  let fractional=0,legacyFractional=0,maxInvertError=0,interiorChanges=0;
  for(let i=0;i<improved.pixels.length;i+=4){const v=improved.pixels[i],old=legacy.pixels[i];if(v>2&&v<253)fractional++;if(old>2&&old<253)legacyFractional++;maxInvertError=Math.max(maxInvertError,Math.abs(v+inverted.pixels[i]-255));if(v===0||v===255)if(Math.abs(v-old)>2)interiorChanges++;}
  const samples=effects.target.samples;
  effects.dispose();mesh.geometry.dispose();mesh.material.dispose();quad.geometry.dispose();legacyMaterial.dispose();renderer.dispose();
  return {fractional,legacyFractional,maxInvertError,interiorChanges,samples,improved:improved.image,legacy:legacy.image};
 });
 assert.ok(antialias.fractional>200,JSON.stringify(antialias.fractional));assert.equal(antialias.legacyFractional,0);assert.ok(antialias.maxInvertError<=1);assert.equal(antialias.interiorChanges,0);
 for(const name of ['legacy','improved']){await fs.writeFile(`${directory}/antialias-${name}.png`,Buffer.from(antialias[name].split(',')[1],'base64'));delete antialias[name];}
 const result=await page.evaluate(async()=>{
  const {createScene}=await import('/src/scenes.ts'),{entity}=await import('/src/model.ts');
  const api=window.__director,engine=api.getEngine(),p=createScene('blank');p.duration=2;p.aspect='16:9';
  const actor=entity('actor','human-adult','行走者',[0,0,0]);actor.id='depth-actor';actor.path={smooth:false,points:[{time:0,position:[-1,0,0]},{time:2,position:[1,0,-2]}]};actor.clips=[{id:'walk',action:'walk',start:0,end:2,speed:1}];p.entities.push(actor);
  const c=p.entities.find(e=>e.camera);c.position=[0,2,7];c.camera.aim='target';c.camera.target=[0,1,0];c.camera.effects={channels:{distortion:.6,focal:{keys:[{time:0,value:28},{time:2,value:45}]}}};c.path={smooth:false,points:[{time:0,position:[0,2,7]},{time:2,position:[1,2,5]}]};
  const second=structuredClone(c);second.id='depth-cam2';second.name='侧机位';second.position=[5,2,2];p.entities.push(second);p.cuts=[{time:0,cameraId:c.id},{time:1,cameraId:second.id}];
  p.referenceLabels=true;p.depthVideo={enabled:true,near:.1,far:20,invert:false,curve:2};api.replaceProject(p);
  const times=[0,.5,23/24,1,1.5,47/24],frames=[];
  for(const time of times){await engine.prepareOutput(time);frames.push({time,data:engine.renderOutput(time,640,360).toDataURL()});}
  await engine.prepareOutput(.5);const before=engine.renderOutput(.5,640,360,c.id,null).toDataURL();
  engine.renderOutput(.5,640,360,c.id,p.depthVideo);const after=engine.renderOutput(.5,640,360,c.id,null).toDataURL();
  if(before!==after)throw Error('normal renderer changed after depth');
  const memoryBefore={...engine.shotRenderer.info.memory};const started=performance.now();
  for(let i=0;i<40;i++)engine.renderOutput(i/24,640,360);
  const elapsed=performance.now()-started,memoryAfter={...engine.shotRenderer.info.memory};
  const video=await api.exportForTest({start:0,end:2,fps:24,width:640,height:360,cameraId:'program',format:'mp4',monochrome:false,depth:p.depthVideo});
  engine.restorePreview(.5);api.setTime(.5);
  return {frames,video,memoryBefore,memoryAfter,elapsed};
 });
 for(const f of result.frames)await fs.writeFile(`${directory}/frame-${f.time.toFixed(3)}.png`,Buffer.from(f.data.split(',')[1],'base64'));
 await fs.writeFile(`${directory}/reference.mp4`,Buffer.from(result.video));
 const decoded=await verifyVideoFrames(page,directory,result.frames.map(f=>f.time));
 assert.deepEqual(result.memoryAfter,result.memoryBefore);
 await page.locator('[data-depth="far"]').fill('25');await page.locator('[data-depth="far"]').press('Tab');
 assert.equal(await page.evaluate(()=>window.__director.getProject().depthVideo.far),25);
 await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>window.__director.getProject().depthVideo.far),20);
 await page.screenshot({path:`${directory}/preview.png`});
 await page.locator('.header-actions [data-act="export"]').click();
 await page.waitForTimeout(700);assert.equal(await page.locator('#export-color').inputValue(),'depth');
 const depthImage=await page.locator('.export-preview img').getAttribute('src');
 await page.locator('#export-color').selectOption('color');await page.waitForTimeout(700);
 assert.notEqual(await page.locator('.export-preview img').getAttribute('src'),depthImage);
 await page.locator('#export-color').selectOption('depth');await page.waitForTimeout(700);
 await page.screenshot({path:`${directory}/export.png`});
 await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(200);
 const bounds=await page.locator('.modal-body').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight}));
 assert.ok(bounds.scrollWidth<=bounds.width+1&&bounds.scrollHeight<=bounds.height+1,JSON.stringify(bounds));
 await page.evaluate(async()=>{
  const {createScene,SCENE_TEMPLATES}=await import('/src/scenes.ts');const api=window.__director,e=api.getEngine();
  for(const template of SCENE_TEMPLATES){const p=createScene(template.id);p.depthVideo={enabled:true,near:.1,far:40,invert:false};api.replaceProject(p);await e.prepareOutput(2);e.renderOutput(2,320,180);e.renderOutput(2,320,180,'program',null);}
 });
 const download=page.waitForEvent('download');
 const toolResult=await page.evaluate(async()=>{
  const api=window.__director,{createScene}=await import('/src/scenes.ts');api.replaceProject(createScene('blank'));
  const call=async(name,args)=>{const r=await api.callTool(name,args);if(!r.ok)throw Error(r.error);return r.data;};
  const read=await call('director_read',{sections:['scene']});
  if(read.depthVideo.enabled!==false)throw Error('missing depth defaults');
  await call('director_apply',{revision:read.revision,requestId:'depth-settings',operations:[{operation:'project',patch:{depthVideo:{enabled:false,near:1,far:15,invert:true,curve:2}}}]});
  const after=await call('director_read',{sections:['scene']});if(after.depthVideo.far!==15)throw Error('depth tool edit lost');
  const job=await call('director_export',{kind:'depth-video',start:0,end:.25,size:640});
  for(let i=0;i<240;i++){const r=await call('director_job',{id:job.jobId});if(r.status==='completed')return {status:r.status,range:after.depthVideo};if(r.status!=='running')throw Error(JSON.stringify(r));await new Promise(r=>setTimeout(r,100));}
  throw Error('depth tool export timed out');
 });
 await (await download).saveAs(`${directory}/tool-depth.mp4`);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({toolResult,pixels,antialias,decoded,memoryBefore:result.memoryBefore,memoryAfter:result.memoryAfter,fortyFramesMs:result.elapsed,bounds,errors},null,2));
} finally {await browser.close();await server.close();}
