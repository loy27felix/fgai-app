import {describe,it,expect} from 'bun:test';
import {createPCMResampler} from '../src/lib/fg-pcm-resampler';
describe('FG streaming PCM conversion',()=>{
 it('keeps 44.1 kHz fractional sampling continuous across uneven worklet chunks',()=>{
  const input=Float32Array.from({length:4410},(_,i)=>Math.sin(i/13)),whole=createPCMResampler(44100)(input),convert=createPCMResampler(44100),chunks=[];
  for(let i=0;i<input.length;i+=137)chunks.push(convert(input.slice(i,i+137)));
  const joined=new Uint8Array(chunks.reduce((n,b)=>n+b.length,0));let at=0;for(const chunk of chunks){joined.set(chunk,at);at+=chunk.length;}
  expect(joined).toEqual(whole);expect(whole.length).toBe(3200);
 });
 it('clamps signed little endian PCM and rejects unsupported sample rates',()=>{
  const bytes=createPCMResampler(16000)(new Float32Array([-2,0,2])),view=new DataView(bytes.buffer);
  expect([view.getInt16(0,true),view.getInt16(2,true),view.getInt16(4,true)]).toEqual([-32768,0,32767]);expect(()=>createPCMResampler(8000)).toThrow();
 });
});
