import {expect,test} from 'bun:test';
import {defaultModelCapabilityConfig} from '../src/lib/model-capabilities';
import {assertVideoCapability} from '../src/services/api/video-validation';
import {resolveImageRequestSize} from '../src/services/api/image-validation';

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
