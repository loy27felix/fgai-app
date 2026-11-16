// Keep an attributed snapshot available when a public source is temporarily offline.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.join(here,'canvas/web/package.json'));
const {build}=require('esbuild');
const bundled=await build({entryPoints:[path.join(here,'canvas/web/src/lib/inspirations/catalog.ts')],bundle:true,write:false,format:'esm',platform:'node',target:'node20'});
const catalog=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const catalogs={};
for(const name of ['seedance','haohaoxue','youmind'])catalogs['catalog-'+name]=JSON.parse(await fs.readFile(path.join(here,'canvas/web/public/inspirations',name+'.json'),'utf8'));
const text=catalog.curatedInspirations.filter(e=>e.mode==='text').map(e=>({...e,image:'',sourceId:e.sourceId||'original',sourceInfo:catalog.inspirationSources[e.sourceId||'original']}));
await fs.writeFile(path.join(here,'gateway/fg-inspiration-seed.json'),JSON.stringify({catalogs,text})+'\n');
console.log(JSON.stringify({catalogs:Object.fromEntries(Object.entries(catalogs).map(([k,v])=>[k,v.entries.length])),text:text.length}));
