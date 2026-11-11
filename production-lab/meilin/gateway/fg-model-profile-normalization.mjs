import {isDeepStrictEqual} from 'node:util';

// Go omitempty removes these documented zero-valued reference constraints.
const omittedDefaults=new Set(['video.references.audioOnlySupported','video.references.minImageSide','video.references.minImageRatio','video.references.maxImageRatio']);
export function profileMatches(expected,value,path=''){
 return Object.entries(expected).every(([key,want])=>{
  const field=path+key,actual=value?.[key];
  if(want&&typeof want==='object'&&!Array.isArray(want))return profileMatches(want,actual,field+'.');
  if(actual===undefined&&omittedDefaults.has(field)&&(want===false||want===0))return true;
  if(field==='image.quality.default'&&want===''&&expected.supported===false&&actual==='auto')return true;
  return isDeepStrictEqual(want,actual);
 });
}
