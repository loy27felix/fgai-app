import type {StoryboardRow} from "@/types/canvas";
import {dramaDialoguePreserved} from "@/lib/short-drama-dialogue";
import {assertLockedEnglishPrompt,assertOriginalEnglishRows,normalizeOriginalEnglishDialogue,normalizeProjectLanguage,type OriginalEnglishCue} from "@/lib/project-language-contract.mjs";

/** Only generated chapter results pass here, never a user's edited shot Prompt.
 * rows.dialogue is the single speech source; the sound block is derived from it. */
export function repairStoryboardDialogue(rows:StoryboardRow[],metadata:Record<string,unknown>){
 const english=metadata.projectLanguagePolicy&&normalizeProjectLanguage(metadata.projectLanguagePolicy).spoken==="en-original";
 const originals=metadata.originalEnglishDialogue as OriginalEnglishCue[]|undefined;
 if(english&&!Array.isArray(originals))throw new Error("原英文台词清单缺失，请核对任务原稿");
 const normalized=rows.map(row=>{
  let dialogue=english?normalizeOriginalEnglishDialogue(row.dialogue,originals!):row.dialogue;
  if(dialogue.replace(/[：:\s]/g,"")===row.dialogue.replace(/[：:\s]/g,""))dialogue=row.dialogue;
  return {...row,dialogue};
 });
 if(english)assertOriginalEnglishRows(normalized,originals!);
 return normalized.map((row,index)=>{
  const repairs:string[]=[];
  if(row.dialogue!==rows[index].dialogue)repairs.push("original_english_cues");
  let mismatch=!row.dialogue.trim()||!dramaDialoguePreserved(row.dialogue,row.videoMotionPrompt);
  if(english)try{assertLockedEnglishPrompt(row.dialogue,row.videoMotionPrompt);}catch{mismatch=true;}
  if(mismatch){
   const prompt=row.videoMotionPrompt,start=prompt.indexOf("【声音设计】");
   if(start>=0){
    const bodyStart=start+"【声音设计】".length,next=prompt.indexOf("【",bodyStart),end=next<0?prompt.length:next;
    const section=prompt.slice(bodyStart,end);
    let keep=false;
    const ambience=section.split(/\r?\n/).filter(line=>{
     const heading=line.replace(/\*\*/g,"").trim().match(/^([^：:]+)[：:]/);
     if(heading)keep=/^(?:音乐|配乐|BGM|背景音乐|环境底声|环境音|环境声|环境音效|人群声音|人物近声|现场细节声|电子声|空间关系|脚步与动作音|动作音|音效|SFX)(?:[（(][^）)]*[）)])?$/i.test(heading[1]);
     return keep&&Boolean(line.trim());
    });
    row.videoMotionPrompt=prompt.slice(0,bodyStart)+"\n"+ambience.join("\n")+"\n对白：\n"+(row.dialogue.trim()||"无对白。")+"\n仅演出以上台词，不增添、改写或复读角色样音。\n\n"+prompt.slice(end);
    repairs.push("sound_dialogue_from_row");
   }
  }
  return {...row,automaticRepairs:repairs};
 });
}
