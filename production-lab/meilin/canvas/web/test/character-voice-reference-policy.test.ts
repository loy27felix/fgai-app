import {expect,test} from "bun:test";
import {hasAuthoredCharacterSpeech} from "@/lib/character-voice-reference-policy";
import {compileCharacterReferencePrompt} from "@/lib/canvas/canvas-character-reference";
test("only performed speech authorizes a character timbre sample",()=>{
 expect(hasAuthoredCharacterSpeech("【声音设计】\n声线：\nEvan：青年男声。\n对白：无。",["Evan"])).toBe(false);
 expect(hasAuthoredCharacterSpeech("【声音设计】\n对白：\n0—3秒 Evan：Wait here.\nMia：Go.",["Evan"])).toBe(true);
 expect(hasAuthoredCharacterSpeech("【声音设计】\n对白：\nMia：Go.\n【资产参考】Evan：低沉",["Evan"])).toBe(false);
 expect(hasAuthoredCharacterSpeech('**Evan**: "Stay."',["Evan Smith","Evan"])).toBe(true);
});
test("video character cards do not inject default wardrobe over a selected look",()=>{
 const definition={role:"主角",appearance:"短发，蓝色西装",clothing:"蓝色西装",physique:"高大",consistencyPrompt:"始终穿蓝色西装"};
 expect(compileCharacterReferencePrompt("Evan",definition,{includeWardrobe:false})).not.toContain("蓝色西装");
 expect(compileCharacterReferencePrompt("Evan",definition)).toContain("蓝色西装");
});
