import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {claim,save,musicInput,audioURL} from './contract.mjs';
test('music input accepts a deliberate song/score request and no external provider model',()=>{
 assert.equal(musicInput({model:'suno-company-music',input:'温暖钢琴',voice:'instrumental'}).instrumental,true);
 assert.equal(musicInput({model:'suno-company-music',input:'歌词',voice:'song'}).instrumental,false);
 assert.throws(()=>musicInput({model:'foreign',input:'a'}));assert.throws(()=>musicInput({model:'suno-company-music',input:'a',response_format:'wav'}));
});
test('custom music survives the native audio instructions field without mixing style text into lyrics',()=>{
 const options={mode:'custom',model:'v6-wild',lyrics:'[Verse]\n一束光',styles:'folk, 90 BPM',title:'光'};
 const input={model:'suno-company-music',input:'folk, 90 BPM',voice:'song'};
 const parsed=musicInput({...input,instructions:JSON.stringify({fgSuno:options})});
 assert.equal(parsed.lyrics,options.lyrics);assert.equal(parsed.styles,options.styles);assert.equal(parsed.sunoModel,'v6-wild');assert.equal(parsed.instrumental,false);
 assert.deepEqual(parsed,musicInput({...input,suno:options}));
 for(const broken of [{...options,lyrics:''},{...options,styles:''},{...options,lyrics:'a'.repeat(5001)},{...options,styles:['folk']},{...options,model:'https://foreign'}])assert.throws(()=>musicInput({...input,suno:broken}),/SUNO_INVALID_INPUT/);
 assert.throws(()=>musicInput({...input,instructions:'{"fgSuno":broken'}),/SUNO_INVALID_INPUT/);
 assert.equal(musicInput({...input,voice:'instrumental',suno:{...options,lyrics:''}}).instrumental,true);
});
test('result URLs never fetch credentials, private hosts or arbitrary redirects',()=>{
 assert.equal(audioURL('https://cdn1.suno.ai/song.mp3'),'https://cdn1.suno.ai/song.mp3');
 assert.equal(audioURL('https://suno-data-uploads.s3.amazonaws.com/song.mp3?X-Amz-Signature=test'),'https://suno-data-uploads.s3.amazonaws.com/song.mp3?X-Amz-Signature=test');
 for(const url of ['http://cdn1.suno.ai/a.mp3','https://127.0.0.1/a.mp3','https://cdn1.suno.ai.evil.com/a.mp3','https://other.s3.amazonaws.com/a.mp3','https://suno-data-uploads.s3.amazonaws.com.evil.com/a.mp3','https://user:pass@cdn1.suno.ai/a.mp3'])assert.throws(()=>audioURL(url));
});
test('parallel and restarted requests claim only one provider submission',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fg-suno-'));
 try{const id='12345678-1234-1234-1234-123456789abc';const batch=await Promise.all(Array.from({length:8},()=>claim(root,id,{prompt:'a'})));assert.equal(batch.filter(x=>x.created).length,1);const first=batch.find(x=>x.created);assert.equal(first.id,id);
 const repeated=await claim(root,id,{prompt:'a'});assert.equal(repeated.created,false);assert.equal(repeated.status,'sending');
 await assert.rejects(()=>claim(root,id,{prompt:'b'}),/CONFLICT/);
 await save(first,{status:'submitted',clipIds:['clip']});await save(first,{status:'uncertain'});
 const restored=await claim(root,id,{prompt:'a'});assert.deepEqual(restored.clipIds,['clip']);assert.equal(restored.id,id);
 }finally{await rm(root,{recursive:true,force:true});}
});
