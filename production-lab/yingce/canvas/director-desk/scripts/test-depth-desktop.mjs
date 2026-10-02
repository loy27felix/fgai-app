import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {_electron as electron} from 'playwright-core';

const root=await fs.mkdtemp(path.resolve('tmp/depth-video/desktop-')),profile=path.join(root,'profile'),exports=path.join(root,'exports');
await fs.mkdir(profile);await fs.mkdir(exports);await fs.writeFile(path.join(profile,'file-locations.json'),JSON.stringify({projects:root,exports}));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[path.resolve('.audit/desktop-app'),`--director-test-profile=${profile}`],env});const errors=[];
try {
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.waitForSelector('[data-depth="enabled"]');await page.locator('[data-depth="enabled"]').selectOption('true');
 await page.locator('[data-depth="far"]').fill('12');await page.locator('[data-depth="far"]').press('Tab');
 await page.locator('[data-depth="curve"]').fill('2');await page.locator('[data-depth="curve"]').press('Tab');
 await page.screenshot({path:path.join(root,'preview.png')});
 await page.locator('.header-actions [data-act="export"]').click();
 await page.locator('#export-name').fill('depth-desktop');await page.locator('#export-end').fill('.5');await page.locator('#export-size').selectOption('640');
 assert.equal(await page.locator('#export-depth-curve').inputValue(),'2');assert.equal(await page.locator('#export-color').inputValue(),'depth');assert.equal(await page.locator('#export-save').inputValue(),'default');
 await page.locator('[data-act="export-start"]').click();await page.waitForSelector('.export-modal',{state:'detached',timeout:60000});
 const file=path.join(exports,'depth-desktop.mp4');assert.ok((await fs.stat(file)).size>1000);
 // Reopen the panel: preview/export choices and range survived export restoration.
 await page.locator('.header-actions [data-act="export"]').click();assert.equal(await page.locator('#export-depth-curve').inputValue(),'2');assert.equal(await page.locator('#export-color').inputValue(),'depth');assert.equal(await page.locator('#export-depth-far').inputValue(),'12');
 await page.locator('.modal-footer [data-act="close-modal"]').click();
 await page.waitForTimeout(1800);assert.deepEqual(errors,[]);
 await fs.writeFile('tmp/depth-video/desktop-result.json',JSON.stringify({profile,file,errors,root},null,2));
 console.log(JSON.stringify({profile,file,errors}));
} finally {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
