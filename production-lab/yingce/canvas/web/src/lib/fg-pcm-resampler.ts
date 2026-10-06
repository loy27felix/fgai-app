/** Continuous mono PCM16 conversion. Fractional bins survive worklet boundaries. */
export function createPCMResampler(sampleRate:number){
 if(!Number.isFinite(sampleRate)||sampleRate<16000||sampleRate>192000)throw Error("不支持的录音采样率");
 const ratio=sampleRate/16000;let remaining=ratio,sum=0;
 return (samples:Float32Array)=>{
  const result:number[]=[];
  for(const value of samples){let weight=1;while(weight>1e-9){const part=Math.min(weight,remaining);sum+=value*part;remaining-=part;weight-=part;
   if(remaining<1e-9){const average=Math.max(-1,Math.min(1,sum/ratio));result.push(Math.round(average*(average<0?32768:32767)));sum=0;remaining=ratio;}
  }}
  const bytes=new ArrayBuffer(result.length*2),view=new DataView(bytes);result.forEach((value,i)=>view.setInt16(i*2,value,true));return new Uint8Array(bytes);
 };
}
