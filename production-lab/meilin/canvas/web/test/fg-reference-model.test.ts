import {expect,test} from 'bun:test';
import {modelCompatibilityError,resolveVideoOperationForModel} from '../src/lib/model-selection';
import {createModelChannel,defaultConfig,type AiConfig} from '../src/stores/use-config-store';
import {defaultModelCapabilityConfig} from '../src/lib/model-capabilities';

test('reference-only model accepts one image without converting it into a first frame',()=>{
 const base=defaultModelCapabilityConfig().video!;
 const video={...base,operations:['reference_to_video'],defaultOperation:'reference_to_video',references:{...base.references,minImages:1,maxImages:9,maxVideos:0,maxAudios:0}};
 const channel=createModelChannel({id:'fg-verified-channel',name:'WeToken',scope:'system',models:['happyhorse-1.1-r2v'],modelCosts:[{model:'happyhorse-1.1-r2v',capability:'video',billingMode:'fixed_request',unitPriceMicrocredits:0,capabilityConfig:{version:1,video}}]});
 const model=channel.id+'::happyhorse-1.1-r2v';const config={...defaultConfig,channels:[channel],model} as AiConfig;
 const input={textCount:1,imageCount:1,videoCount:0,audioCount:0,characterCount:0};
 expect(resolveVideoOperationForModel(config,model,input)).toBe('reference_to_video');
 expect(modelCompatibilityError(config,model,{capability:'video',input})).toBe('');
 expect(modelCompatibilityError(config,model,{capability:'video',input:{...input,imageCount:0}})).toContain('至少需要');
});
