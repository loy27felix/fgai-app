import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogCoverURL,normalizeCatalog,catalogSources} from './fg-inspiration-catalog.mjs';
test('catalog public thumbnail paths resolve against the actual source repository',()=>{
 const path='/inspiration-thumbs/youmind/13515.webp';
 assert.equal(catalogCoverURL(path),'https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/main/web/public'+path);
 const entry=normalizeCatalog({entries:[{id:'youmind:13515',title:'地图',prompt:'手绘地图',image:path}]},catalogSources[2])[0];
 assert.equal(entry.cover,entry.media[0].url);assert.ok(entry.cover.endsWith('/13515.webp'));
});
test('thumbnail normalization cannot turn arbitrary local or parent paths into remote reads',()=>{
 for(const path of ['/etc/passwd','/inspiration-thumbs/../secret.webp','//localhost/a.png','http://localhost/a.png','data:image/png;base64,a'])assert.equal(catalogCoverURL(path),'');
});
