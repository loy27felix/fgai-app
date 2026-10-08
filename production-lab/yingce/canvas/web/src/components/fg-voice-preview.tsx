import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { fgSpeechVoices } from "@/lib/fg-speech-voices";

// Recorded once with the company channel. Listening never submits a paid request.
export function FGVoicePreview({voice,compact=false}:{voice:string;compact?:boolean}) {
    const audio=useRef<HTMLAudioElement|null>(null);
    const [playing,setPlaying]=useState(false),[failed,setFailed]=useState(false);
    const name=fgSpeechVoices.find(v=>v.value===voice)?.label;
    useEffect(()=>{setPlaying(false);setFailed(false);return()=>{audio.current?.pause();};},[voice]);
    if(!name)return null;
    return <div className={compact?"text-center":"flex items-center gap-3"}>
        <button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs transition hover:bg-blue-500/10 disabled:opacity-50" aria-label={`${playing?"停止":"试听"}${name}`} onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setFailed(false);const el=audio.current;if(!el)return;if(playing){el.pause();el.currentTime=0;setPlaying(false);}else{void el.play().then(()=>setPlaying(true)).catch(()=>{setPlaying(false);setFailed(true);});}}}>
            {playing?<Square size={12}/>:<Play size={12}/>} {playing?"停止":"试听"}
        </button>
        {!compact&&<span className="text-xs opacity-60">{name} · 公司真实音色样本</span>}
        {failed&&<span role="status" className="text-xs text-amber-600">样本暂时无法播放，请重试</span>}
        <audio ref={audio} key={voice} preload="none" src={`${import.meta.env.BASE_URL}fg-voice-previews/${voice}.mp3`} onEnded={()=>setPlaying(false)} onPause={()=>setPlaying(false)} />
    </div>;
}
