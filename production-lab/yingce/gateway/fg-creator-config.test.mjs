import {test} from 'node:test';import assert from 'node:assert/strict';
import {creatorGenerationConfig} from './fg-creator-config.mjs';
test('native director sizes preserve aspect ratio and use the enabled model resolution tier',()=>{
 const selected={profile:{image:{size:{parameter:'size',values:['2048x2048','2496x1664'],default:'2048x2048',allowCustom:true,presets:[{size:'2048x2048',ratio:'1:1',tier:'2k'},{size:'2496x1664',ratio:'3:2',tier:'2k'}]},quality:{supported:false,default:'',values:[]}}}};
 assert.equal(creatorGenerationConfig(selected,{size:'1536x1024'},'image').size,'2496x1664');
 assert.throws(()=>creatorGenerationConfig(selected,{quality:'low'},'image'));
 assert.equal(creatorGenerationConfig(selected,{quality:'low'},'image',{standardImageQuality:true}).quality,'');
});
test('sound setting is forwarded and unsupported video parameters are rejected before admission',()=>{
 const selected={profile:{video:{duration:{values:[4,5,10],default:5},ratios:['16:9'],defaultRatio:'16:9',resolutions:['480p','720p'],defaultResolution:'480p',generateAudio:{supported:true,default:true}}}};
 assert.equal(creatorGenerationConfig(selected,{generate_audio:true},'video').videoGenerateAudio,'true');
 assert.equal(creatorGenerationConfig(selected,{generate_audio:false},'video').videoGenerateAudio,'false');
 assert.throws(()=>creatorGenerationConfig(selected,{duration:99},'video'));
 assert.throws(()=>creatorGenerationConfig(selected,{resolution:'2K'},'video'));
});
