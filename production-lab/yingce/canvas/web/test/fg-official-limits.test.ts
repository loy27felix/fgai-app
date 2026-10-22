import {expect,test} from 'bun:test';
import {defaultModelCapabilityConfig} from '../src/lib/model-capabilities';
import {assertVideoCapability} from '../src/services/api/video-validation';
import {resolveImageRequestSize} from '../src/services/api/image-validation';

test('reference video errors distinguish too few pixels from too many and identify the reference',()=>{
 const v=defaultModelCapabilityConfig().video!;
 const profile={...v,references:{...v.references,maxVideos:3,minVideoPixels:407696,maxVideoPixels:8295044}};
 const ref={id:'a',name:'dance',type:'video/mp4',url:'https://example.com/a',durationMs:14000,width:640,height:640};
 expect(()=>assertVideoCapability(profile,[],[ref],[],'5')).not.toThrow();
 expect(()=>assertVideoCapability(profile,[],[ref,{...ref,width:576,height:576}],[],'5')).toThrow('第 2 个参考视频尺寸为 576×576（331776 像素），低于模型最低要求 407696 像素');
 expect(()=>assertVideoCapability(profile,[],[{...ref,width:3840,height:2160}],[],'5')).not.toThrow();
 expect(()=>assertVideoCapability(profile,[],[{...ref,width:3840,height:2161}],[],'5')).toThrow('高于模型上限 8295044 像素');
 expect(()=>assertVideoCapability(profile,[],[{...ref,width:614,height:664}],[],'5')).not.toThrow();
 expect(()=>assertVideoCapability(profile,[],[{...ref,width:3326,height:2494}],[],'5')).not.toThrow();
});

test('Wan reference and output durations share a 30 second budget',()=>{
 const v=defaultModelCapabilityConfig().video!;
 const profile={...v,duration:{selection:'enum' as const,values:Array.from({length:29},(_,i)=>i+2),default:5},references:{...v.references,maxInputOutputDurationSeconds:30,maxVideos:5,maxVideoDurationSeconds:15,maxImageSide:8000,maxVideoSide:4096}};
 const ref={id:'a',name:'test',type:'video/mp4',url:'https://example.com/a',durationMs:10000,width:1920,height:1080};
 expect(()=>assertVideoCapability(profile,[],[ref],[],'20')).not.toThrow();
 expect(()=>assertVideoCapability(profile,[],[ref],[],'21')).toThrow('合计');
 expect(()=>assertVideoCapability(profile,[],[{...ref,width:5000}],[],'20')).toThrow('宽高');
});

test('Wan reference edits cannot submit text-only 4K output',()=>{
 const profile=defaultModelCapabilityConfig().image!;
 profile.size={...profile.size,allowCustom:true,constraints:{minPixels:589824,maxPixels:16777216,maxRatio:8,maxReferencePixels:4194304}};
 expect(resolveImageRequestSize(profile,undefined,'4096x4096',0)?.value).toBe('4096x4096');
 expect(()=>resolveImageRequestSize(profile,undefined,'4096x4096',1)).toThrow('2K');
 expect(resolveImageRequestSize(profile,undefined,'2048x2048',1)?.value).toBe('2048x2048');
});

test('30s profile enforces accumulated source duration, not a global 15s cap',()=>{
 const v=defaultModelCapabilityConfig().video!;
 const profile={...v,duration:{selection:'enum' as const,values:Array.from({length:27},(_,i)=>i+4),default:5},references:{...v.references,maxVideos:10,maxVideoDurationSeconds:30,minVideoDurationSeconds:2,maxTotalVideoDurationSeconds:30}};
 const ref={id:'a',name:'test',type:'video/mp4',url:'https://example.com/a',durationMs:15000};
 expect(()=>assertVideoCapability(profile,[],[ref,ref],[],'30')).not.toThrow();
 expect(()=>assertVideoCapability(profile,[],[ref,{...ref,durationMs:15001}],[],'30')).toThrow('累计');
 expect(()=>assertVideoCapability(profile,[],[],[],'31')).toThrow('时长');
});
test('Seedream custom pixels preserve provider dimensions and reject undersized input',()=>{
 const profile=defaultModelCapabilityConfig().image!;
 profile.size={...profile.size,allowCustom:true,constraints:{minPixels:3686400,maxPixels:16777216,maxRatio:16}};
 expect(resolveImageRequestSize(profile,undefined,'3750x1250')?.value).toBe('3750x1250');
 expect(resolveImageRequestSize(profile,undefined,'6240x2656')?.value).toBe('6240x2656');
 expect(()=>resolveImageRequestSize(profile,undefined,'1500x1500')).toThrow('官方范围');
});
