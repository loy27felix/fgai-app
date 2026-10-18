import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {capabilities} from './fg-model-capabilities.mjs';

const imageSpec=id=>({id,capability:'image',protocol:'openai-image',price:{capabilities:{params:{size:{values:['1024x1024']},quality:{values:['wrong-vendor-value']}}}}});
test('standalone backend protocol fixture matches the deployed Gemini plugin',{skip:!fs.existsSync(new URL('../canvas/backend/internal/protocol/testdata/fg-wetoken-gemini-image.yingce-plugin',import.meta.url))},()=>{
 assert.deepEqual(fs.readFileSync(new URL('./protocol-packages/fg-wetoken-gemini-image.yingce-plugin',import.meta.url)),fs.readFileSync(new URL('../canvas/backend/internal/protocol/testdata/fg-wetoken-gemini-image.yingce-plugin',import.meta.url)));
});
test('Nano Banana 2.1 follows Google tiers and ratios rather than reseller defaults',()=>{
 const p=capabilities(imageSpec('gemini-nano-banana-2.1')).image;
 assert.deepEqual(p.quality.values,['1K','2K','4K']);
 assert.equal(p.size.default,'auto');
 assert.equal(p.size.values.length,15);
 for(const ratio of ['auto','1:4','4:1','1:8','8:1','4:5','5:4'])assert.ok(p.size.values.includes(ratio));
 assert.equal(p.references.maxImages,14);
 assert.equal(p.size.allowCustom,false);
 assert.equal(p.transparentBackground.supported,false);
});
for(const id of ['gpt-image-2','gpt-image-2.5-flare','gpt-image-2.5-sunburst']){
 test(`${id} uses the official size and quality contract independently of vendor metadata`,()=>{
  const p=capabilities(imageSpec(id)).image;
  assert.equal(p.size.allowCustom,true);
  for(const size of ['auto','1024x1024','1536x1024','1024x1536','2048x2048','2048x1152','3840x2160','2160x3840'])assert.ok(p.size.values.includes(size),size);
  for(const size of p.size.values.filter(x=>x!=='auto')){
   const [w,h]=size.split('x').map(Number);
   assert.ok(w%16===0&&h%16===0&&Math.max(w,h)<=3840&&Math.max(w,h)/Math.min(w,h)<=3&&w*h>=655360&&w*h<=8294400,size);
  }
  assert.deepEqual(p.quality.values,id==='gpt-image-2'?['auto','low','medium','high']:['auto','low','medium','high','xhigh','max']);
  assert.equal(p.quality.default,'low');
  assert.equal(p.maxOutputs,10);
  assert.equal(p.transparentBackground.supported,true);
  assert.equal(p.outputFormat.supported,true);
  assert.equal(p.responseFormat.supported,false);
  assert.equal(p.references.maxImages,16);
  assert.equal(p.references.maxImageBytes,50*1024*1024);
 });
}
test('Wan3 official limits override obsolete vendor duration and reference fields',()=>{
 const p=capabilities({id:'wan3.0-video',capability:'video',protocol:'fg-wetoken-wan3-video',price:{capabilities:{params:{duration:{values:[5,10,15]},ratio:{values:['wrong']},resolution:{values:['wrong']}}}}}).video;
 assert.deepEqual(p.duration.values,Array.from({length:29},(_,i)=>i+2));
 assert.deepEqual(p.ratios,['adaptive','21:9','16:9','4:3','1:1','3:4','9:16']);
 assert.deepEqual(p.resolutions,['480p','720p','1080p']);
 assert.equal(p.references.promptMaxChars,20000);
 assert.equal(p.references.maxImages,10);
 assert.equal(p.references.maxVideos,5);
 assert.equal(p.references.maxAudios,5);
 assert.equal(p.references.maxTotalVideoDurationSeconds,15);
 assert.equal(p.references.maxTotalAudioDurationSeconds,15);
 assert.equal(p.watermark.supported,true);
 assert.equal(p.generateAudio.supported,true);
});
