/** A timbre sample is useful only when this actor has an authored spoken line. */
export function hasAuthoredCharacterSpeech(prompt: string, names: string[]) {
    const plain = prompt.replace(/^\s*#{1,6}\s*/gm, "").replace(/\*\*|__/g, "");
    const sound = plain.split("【声音设计】")[1]?.split(/【[^】]+】/)[0] ?? plain.split(/【(?:角色参考|资产参考|场景与道具参考)】/)[0];
    let profile = false;
    for (let line of sound.split(/\r?\n/)) {
        if (/^\s*(?:基础)?声线(?:设定|特征|说明)?\s*[：:]\s*$/.test(line)) { profile = true; continue; }
        if (/^\s*(?:对白|台词)(?:[（(][^）)]*[）)])?\s*[：:]/.test(line)) { profile = false; line = line.replace(/^.*?[：:]\s*/, ""); }
        if (profile) continue;
        line = line.replace(/^\s*(?:[-*]\s*)?(?:[（(]?约?\d+(?:\.\d+)?\s*[—–\-~～至]\s*\d+(?:\.\d+)?\s*秒[）)]?\s*[，,｜|]?\s*)?/, "");
        for (const name of names.filter(Boolean)) {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const cue = line.match(new RegExp(`^${escaped}(?:\\s*[（(][^）)]*[）)])?\\s*[：:]\\s*(.+)$`, "i"))?.[1];
            if (cue && !/^(?:无(?:对白|台词)?|不说话|保持无声|none|no dialogue)[。.!\s]*$/i.test(cue) && !/^(?:成年|青年|中年|老年|男声|女声|音色|语速)/.test(cue)) return true;
            if (new RegExp(`^${escaped}\\s*(?:says?|speaks?|说|低声说|喊道)\\s*[：:]?\\s*[“"‘']`, "i").test(line)) return true;
        }
    }
    return false;
}

export const VIDEO_SPEECH_BOUNDARY = "角色卡与音频样本只提供人物身份及音色，不提供本片台词。只说当前视频提示词明确指定的对白；没有指定对白的角色保持无声，不复读、续写或翻译样音内容，不自行添加人声或旁白。";
