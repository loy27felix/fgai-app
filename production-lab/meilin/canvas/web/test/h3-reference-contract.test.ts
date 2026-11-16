import { test, expect } from "bun:test";
import { capabilities } from "../../../gateway/fg-model-capabilities.mjs";
import { assertVideoCapability } from "../src/services/api/video-validation";
import type { VideoCapabilityConfig } from "../src/lib/model-capabilities";

test("H3 enforces the combined reference limit before a paid request", () => {
    const profile = capabilities({id:"MiniMax-H3",capability:"video",protocol:"minimax-video"}).video as VideoCapabilityConfig;
    const images = Array.from({length:9}, (_,i)=>({id:String(i),name:"reference",type:"image/png",dataUrl:""}));
    const videos = Array.from({length:3}, (_,i)=>({id:String(i),name:"reference",type:"video/mp4",dataUrl:"",durationMs:2000}));
    const audio = [{id:"voice",name:"voice",type:"audio/wav",dataUrl:"",durationMs:2000}];
    expect(()=>assertVideoCapability(profile,images,videos,[],"5")).not.toThrow();
    expect(()=>assertVideoCapability(profile,images,videos,audio,"5")).toThrow("合计最多 12");
});
