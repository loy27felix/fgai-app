import {ApiError,http} from "@/services/api/request";
export type SpeechJob={id:string;kind:"transcription"|"translation"|"streaming";status:string;error?:string;result?:{text:string;segments?:{start:number;end:number;text:string}[]};createdAt:string};
export const speechJobs=()=>http.get<{jobs:SpeechJob[]}>("/fg/speech/jobs");
export type CompanyMusicStatus={available:boolean;configured:boolean;enabled:boolean;accountReadable?:boolean;captchaRequired?:boolean;models?:{id:string;name:string}[]};
export const companyMusicStatus=()=>http.get<CompanyMusicStatus>("/fg/music/status");
export const createSpeechJob=(input:Record<string,unknown>)=>http.post<SpeechJob>("/fg/speech/jobs",input);
export type MusicJob={id:string;ownerName?:string;status:string;resourceId?:string;clipId?:string;brief:{title:string;model:string;mode:string;voice:string;styles:string;lyrics:string;description:string};createdAt:string};
export const musicJobs=()=>http.get<{canManage:boolean;jobs:MusicJob[]}>("/fg/music/jobs");
export const createMusicJob=(input:Record<string,unknown>)=>http.post<MusicJob>("/fg/music/jobs",input);
export const startMusicJob=(id:string)=>http.post<MusicJob>(`/fg/music/jobs/${encodeURIComponent(id)}/start`,{});
export const completeMusicJob=(id:string,clipId:string)=>http.post<MusicJob>(`/fg/music/jobs/${encodeURIComponent(id)}/complete`,{clipId});
export async function generateCompanySpeech(input:Record<string,unknown>,operationId:string){
 try{
 // Preserve structured Suno fields through the native audio task's existing
 // instructions field. Plain TTS instructions keep their original meaning.
 const data=input.model==="suno-company-music"&&input.suno?{...input,instructions:JSON.stringify({fgSuno:input.suno})}:input;
 const response=await http.raw<Blob>({method:"POST",url:"/fg/speech/generate",data,responseType:"blob",timeout:330000,headers:{"x-fg-operation-id":operationId}});
 if(!response.data.type.startsWith("audio/"))throw Error("音频结果尚未就绪，请查看制作历史");
 return response.data;
 }catch(error){
  if(error instanceof ApiError){
   const cause=error.cause as {response?:{data?:unknown}}|undefined;
   if(cause?.response?.data instanceof Blob && cause.response.data.size<65536){
    let envelope:{msg?:string;error?:string}|undefined;
    try{envelope=JSON.parse(await cause.response.data.text());}catch{/* Preserve the existing transport error. */}
    const message=envelope?.msg||envelope?.error;
    if(message)throw new ApiError(message,{status:error.status,code:error.code,retryable:false,cause:error});
   }
  }
  throw error;
 }
}
export function speechSRT(segments:{start:number;end:number;text:string}[]){
 const stamp=(seconds:number)=>{const total=Math.max(0,Math.round(seconds*1000));return `${String(Math.floor(total/3600000)).padStart(2,"0")}:${String(Math.floor(total/60000)%60).padStart(2,"0")}:${String(Math.floor(total/1000)%60).padStart(2,"0")},${String(total%1000).padStart(3,"0")}`;};
 return segments.map((s,i)=>`${i+1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.text}\n`).join("\n");
}
