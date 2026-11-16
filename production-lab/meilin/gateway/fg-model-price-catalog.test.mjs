import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {modelPriceRows} from './fg-model-price-catalog.mjs';
import {speechModels,speechUtilities} from './fg-speech-provider.mjs';
import {priceQuote} from './fg-quotes.mjs';
import {capabilities} from './fg-model-capabilities.mjs';

const specs=JSON.parse(await fs.readFile(new URL('./model-specs.json',import.meta.url),'utf8'));
test('Wan 3 declares the documented 2 to 30 second range without changing other models',()=>{
 const profile=capabilities(specs.find(s=>s.id==='wan3.0-video')).video;
 assert.deepEqual(profile.duration.values,Array.from({length:29},(_,i)=>i+2));
 assert.equal(profile.duration.default,5);
 assert.equal(profile.generateAudio.supported,true);
 assert.deepEqual(profile.resolutions,['480p','720p','1080p']);
 const other=capabilities(specs.find(s=>s.id==='dreamina-seedance-2-0-mini-filter-off')).video;
 assert.equal(Math.max(...other.duration.values),15);
});
test('price list keeps all WeToken rows when company speech and Suno are added',()=>{
 const prices=[...specs.map(s=>({model:s.id,snapshot:{...s.price,enabled:true,discount:1}})),
  ...[...speechModels,...speechUtilities].map(s=>({model:s.id,snapshot:{enabled:true,provider:'volcengine',discount:1}})),
  {model:'suno-company-music',snapshot:{enabled:true,provider:'suno',discount:1}},
  {model:'future-provider-model',snapshot:{enabled:true,discount:1}}];
 const rows=modelPriceRows(prices,specs,[],7);
 assert.equal(rows.length,prices.length);
 for(const id of ['seed-tts-2.0','suno-company-music']){
  const row=rows.find(r=>r.model===id);
  assert.equal(row.capability,'audio');assert.equal(row.profile.video,undefined);
  assert.equal(row.quote.estimatedCny,null);
 }
 const unknown=rows.find(r=>r.model==='future-provider-model');
 assert.equal(unknown.enabled,false);assert.equal(unknown.capability,'unknown');
 assert.equal(unknown.quote.estimatedCny,null);
 assert.equal(rows.find(r=>r.model==='suno-company-music').quote.discount,null);
});
test('existing image quote remains unchanged and evidence matches full model keys',()=>{
 const spec=specs.find(s=>s.capability==='image');const profile=capabilities(spec);
 const p={model:spec.id,snapshot:{...spec.price,enabled:true,discount:1}};
 const evidence=[{model:'CHANNEL::'+spec.id,status:'succeeded',operation:'text_to_image'},
  {model:'CHANNEL::other-model',status:'failed'},
  {model:'seed-tts-2.0',status:'succeeded',operation:'speech'}];
 const rows=modelPriceRows([p,{model:'seed-tts-2.0',snapshot:{provider:'volcengine',enabled:true}}],specs,evidence,7);
 assert.deepEqual(rows[0].quote,priceQuote(spec.id,p.snapshot,{capability:'image',inputs:{},
  options:{size:profile.image.size.default,quality:profile.image.quality.default,count:1}},7));
 assert.equal(rows[0].evidence.length,1);assert.equal(rows[1].evidence.length,1);
});
