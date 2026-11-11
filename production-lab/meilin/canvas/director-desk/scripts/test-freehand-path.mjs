import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const directory='tmp/freehand-path';await fs.mkdir(directory,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:{ignored:['**/tmp/**','**/.local/**']}}});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);await page.waitForFunction(()=>window.__director);
 await page.evaluate(async()=>{
  const {createScene}=await import('/src/scenes.ts'),{entity}=await import('/src/model.ts');
  const api=window.__director,p=createScene('blank');p.duration=12;
  const a=entity('actor','human-adult','手绘测试',[0,0,0]);a.id='freehand-subject';p.entities.push(a);
  api.replaceProject(p);const r=await api.callTool('director_view',{entityId:a.id,time:2});if(!r.ok)throw Error(r.error);
 });
 await page.locator('[data-inspect="path"]').click();
 await page.locator('#path-draw-mode').selectOption('freehand');
 await page.locator('#path-surface-mode').selectOption('ground');
 await page.locator('#path-draw-duration').fill('4');await page.locator('#path-draw-duration').press('Tab');
 const before=await page.evaluate(()=>JSON.stringify(window.__director.getProject()));
 const start=async()=>{
  await page.locator('[data-act="draw-path"]').click();
  await page.evaluate(()=>{const e=window.__director.getEngine();e.viewTop();e.needsRender=true;});await page.waitForTimeout(200);
 };
 const project=()=>page.evaluate(()=>window.__director.getProject());
 const actor=async()=>(await project()).entities.find(e=>e.id==='freehand-subject');
 const screen=async(points)=>page.evaluate(async points=>{
  const {Vector3}=await import('/node_modules/.vite/deps/three.js'),e=window.__director.getEngine(),r=e.editorRenderer.domElement.getBoundingClientRect();
  return points.map(p=>{const v=new Vector3(...p).project(e.editorCamera);return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};});
 },points);
 const drag=async(points,release=true)=>{
  const positions=await screen(points);await page.mouse.move(positions[0].x,positions[0].y);await page.mouse.down();
  for(const p of positions.slice(1)){await page.mouse.move(p.x,p.y,{steps:10});await page.waitForTimeout(20);}
  if(release)await page.mouse.up();
 };
 await start();
 const camera=await page.evaluate(()=>window.__director.getEngine().editorCamera.position.toArray());
 await drag([[0,0,0],[2,0,0],[2,0,2]],false);
 assert.equal((await actor()).path.points.length,1,'draft must not be rebuilt while drawing');
 assert.equal(await page.evaluate(()=>window.__director.getEngine().drawingStroke),true);
 await page.screenshot({path:`${directory}/live.png`});
 await page.mouse.up();
 let route=(await actor()).path;assert.ok(route.points.length>=3&&route.points.length<12,JSON.stringify(route));
 assert.ok(Math.abs(route.points.at(-1).position[2]-2)<.1);assert.equal(route.points[0].time,2);assert.equal(route.points.at(-1).time,6);
 assert.deepEqual(await page.evaluate(()=>window.__director.getEngine().editorCamera.position.toArray()),camera);
 await drag([[2,0,2],[3,0,2],[3,0,3]]);route=(await actor()).path;assert.equal(route.points.at(-1).time,6);
 await page.keyboard.press('Enter');await page.waitForTimeout(100);
 const finished=JSON.stringify(await project());
 await page.evaluate(async()=>{const {assertProject}=await import('/src/model.ts');assertProject(window.__director.getProject());});
 await page.screenshot({path:`${directory}/finished.png`});
 await page.keyboard.press('Control+z');assert.equal(JSON.stringify(await project()),before,'one undo restores the whole draw session');
 await page.keyboard.press('Control+Shift+z');assert.equal(JSON.stringify(await project()),finished);
 await start();await drag([[0,0,0],[1,0,1]],false);await page.keyboard.press('Escape');await page.mouse.up();
 assert.equal(JSON.stringify(await project()),finished,'Escape restores prior route');
 assert.deepEqual(await page.evaluate(()=>{const e=window.__director.getEngine();return {drawing:e.drawingStroke,orbit:e.orbit.enabled,cursor:e.editorRenderer.domElement.style.cursor};}),{drawing:false,orbit:true,cursor:''});
 await start();await drag([[0,0,0],[1,0,1]],false);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();
 assert.equal((await actor()).path.points.length,1,'blur cancels current stroke');
 await page.keyboard.press('Escape');
 await start();await drag([[0,0,0],[1,0,1]],false);
 const rect=await page.locator('#stage-canvas canvas').boundingBox();
 await page.mouse.move(rect.x+rect.width+30,rect.y+rect.height/2,{steps:5});await page.waitForTimeout(30);
 const [back]=await screen([[-2,0,-2]]);await page.mouse.move(back.x,back.y,{steps:5});await page.mouse.up();
 assert.ok((await actor()).path.points.every(p=>p.position[0]>-.1),'re-entry must not bridge across an interrupted stroke');
 await page.keyboard.press('Escape');
 await start();await drag([[0,0,0],[1,0,1]],false);
 await page.evaluate(()=>{const e=window.__director.getEngine();e.editorRenderer.domElement.dispatchEvent(new PointerEvent('pointercancel',{pointerId:e.freehandInput.pointer}));});
 await page.mouse.up();assert.equal((await actor()).path.points.length,1);await page.keyboard.press('Escape');
 // Ordinary point placement remains available after freehand input has been cancelled.
 await page.locator('#path-draw-mode').selectOption('points');await start();
 const [point]=await screen([[2,0,1]]);await page.mouse.click(point.x,point.y);await page.keyboard.press('Enter');
 assert.equal((await actor()).path.points.length,2);assert.equal((await actor()).path.points[1].time,4);
 // Real surface raycasts must keep stair elevations instead of flattening onto the ground.
 await page.evaluate(async()=>{
  const {entity}=await import('/src/model.ts'),api=window.__director,p=api.getProject();
  const a=p.entities.find(e=>e.id==='freehand-subject');a.path=null;a.position=[0,0,1];
  const stairs=entity('prop','stairs','测试楼梯',[0,0,0]);p.entities.push(stairs);api.replaceProject(p);
  const r=await api.callTool('director_view',{entityId:a.id,time:0});if(!r.ok)throw Error(r.error);
 });
 await page.locator('#path-draw-mode').selectOption('freehand');await page.locator('#path-surface-mode').selectOption('surface');
 await start();await drag([[0,0,1],[0,0,.4],[0,0,0],[0,0,-.6],[0,0,-1.4]]);
 await page.keyboard.press('Enter');
 const stairs=(await actor()).path;
 assert.ok(stairs.points.some(p=>p.position[1]>.95),JSON.stringify(stairs));
 assert.ok(new Set(stairs.points.map(p=>p.position[1].toFixed(2))).size>=6,'stair heights lost');
 assert.ok(stairs.points.length<40,JSON.stringify(stairs));
 assert.equal(stairs.smooth,false);await page.screenshot({path:`${directory}/stairs.png`});
 await page.evaluate(async()=>{const {assertProject}=await import('/src/model.ts');assertProject(window.__director.getProject());});
 await page.setViewportSize({width:1280,height:720});await start();await page.waitForTimeout(100);
 const layout=await page.locator('#inspector-content').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth}));
 assert.ok(layout.scrollWidth<=layout.width+1,JSON.stringify(layout));
 const cancel=page.locator('[data-act="cancel-path"]');assert.ok(await cancel.evaluate(e=>e.clientWidth>50&&e.clientHeight<40));
 await page.screenshot({path:`${directory}/compact.png`});await cancel.click();
 // Both drawing modes preserve camera height above the selected elevated floor.
 await page.evaluate(async()=>{
  const {createScene}=await import('/src/scenes.ts'),{emptyEditorView}=await import('/src/building/floors.ts');
  const api=window.__director,p=createScene('blank'),c=p.entities.find(e=>e.kind==='camera');
  p.floors=[{id:'upper',name:'Upper',elevation:3}];p.editorView={...emptyEditorView(),activeFloorId:'upper'};
  c.position=[0,4.7,0];c.path=null;c.floorId='upper';api.replaceProject(p);
  const r=await api.callTool('director_view',{entityId:c.id,time:0});if(!r.ok)throw Error(r.error);
 });
 await page.locator('[data-inspect="path"]').click();await page.locator('#path-surface-mode').selectOption('ground');
 for(const mode of ['points','freehand']) {
  await page.locator('#path-draw-mode').selectOption(mode);
  const beforeCamera=JSON.stringify(await project());await start();
  if(mode==='points'){const [p]=await screen([[2,3,1]]);await page.mouse.click(p.x,p.y);}
  else await drag([[0,3,0],[2,3,0],[2,3,2]]);
  await page.keyboard.press('Enter');
  const route=(await project()).entities.find(e=>e.kind==='camera').path;
  assert.ok(route.points.length>1,JSON.stringify(route));
  assert.ok(route.points.every(p=>Math.abs(p.position[1]-4.7)<.01),JSON.stringify(route));
  await page.keyboard.press('Control+z');assert.equal(JSON.stringify(await project()),beforeCamera);
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({route,stairs,layout,checks:'live preview, time, continuation, undo/redo, Escape, blur, point placement, surface heights, elevated camera point/freehand height',errors},null,2));
}finally{await browser.close();await server.close();}
