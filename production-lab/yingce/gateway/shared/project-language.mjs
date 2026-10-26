export const defaultProjectLanguage = Object.freeze({ version: 1, spoken: 'source', screenText: 'source' });
export function normalizeProjectLanguage(value) {
  if (typeof value === 'string') value = value.trim() ? JSON.parse(value) : undefined;
  if (value == null) return { ...defaultProjectLanguage };
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['version','spoken','screenText'].includes(key)) || value.version !== 1 || !['source','en-original'].includes(value.spoken) || !['source','no-zh','none'].includes(value.screenText)) throw Error('项目语言设置格式无效');
  return { version: 1, spoken: value.spoken, screenText: value.screenText };
}
const begin = '【项目制作语言设置】', end = '【项目制作语言设置结束】';
export function projectLanguageInstructions(value, mode = 'text') {
  const policy = normalizeProjectLanguage(value), lines = [];
  if (policy.spoken === 'en-original' && mode !== 'image') lines.push('对白、旁白与可听见的人声只使用原剧本已有的英文原句。中英对照中的中文仅为理解译文，不参与配音。逐字保留原英文的用词、语序、缩写和说话人；不重新翻译、不润色、不意译、不自行新增英文台词。找不到对应英文原句时停止并提示确认原稿，不自行编写。');
  if (policy.screenText !== 'source' && mode !== 'audio') lines.push(policy.screenText === 'none'
    ? '画面不渲染任何文字、字幕、人物名、标签、水印或标识。内部资产名与制作说明不属于画面内容。'
    : '画面禁止出现中文字符、中文字幕、中文人物名、中文标注和中文水印。角色多视图不写“正面、侧面、背面”等标签。仅在剧本明确要求时显示已确认的英文画面文字，否则保持无字。');
  if (!lines.length) return '';
  return [begin, ...lines, '后台资产名称、提示词说明和制作沟通可继续使用中文；它们不是需要朗读或画出的内容。', end].join('\n');
}
export function applyProjectLanguage(prompt, value, mode = 'text') {
  const block = projectLanguageInstructions(value, mode);
  if (!block) return prompt;
  const escaped = new RegExp(`${begin}[\\s\\S]*?${end}`, 'g');
  return [String(prompt || '').replace(escaped, '').trim(), block].filter(Boolean).join('\n\n');
}
export function projectLanguageTemplateVariables(variables, policy, mode = 'text') {
  const values={...variables};
  const target=['资产技能','负面要求','用户要求','角色设定','项目视觉','项目画风','要求'].find(key=>typeof values[key]==='string') || '要求';
  values[target]=applyProjectLanguage(values[target]||'',policy,mode);return values;
}
const han = /\p{Script=Han}/u;
const clean = text => text.normalize('NFKC').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim().replace(/^"([\s\S]*)"$/,'$1');
const speakerKey = text => text.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const metadata = /^(?:音乐|环境底声|环境音|人群声音|人物近声|现场细节声|电子声|空间关系|时间|说话时机|对白时间|对白语言|声音语言|声线|基础声线|声线设定|表演要求|声音特征|无对白|地点|时间与天气|场景|出场人物|人物|场次|scene|location|characters|setting|time|music|sound|dialogue|translation|中文|英文)$/i;
function speech(line) {
  let value = String(line).trim().replace(/^(?:[-*]\s+)?(?:\*\*)?/, '').replace(/\*\*/g,'');
  value = value.replace(/^[（(]?约?\s*\d+(?:\.\d+)?\s*[—–\-~～至]\s*\d+(?:\.\d+)?\s*秒[）)]?\s*[，,｜|]?\s*/, '');
  const match = value.match(/^([^：:\n]{1,100})[：:]\s*(.+)$/);
  if (!match) return undefined;
  const speaker = match[1].replace(/[（(][^）)]*[）)]/g,'').replace(/(?:画外音|画内音)(?:继续(?:同一句|对白|台词)?)?$/u,'').trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'’·\-]*$/u.test(speaker) || metadata.test(speaker) || /声线$/.test(speaker)) return undefined;
  const text = match[2].trim();
  return text ? { speaker, text } : undefined;
}
function plainScript(value) {
  return String(value || '').replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])\s*>/gi,'\n').replace(/<[^>]*>/g,'')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:\d+|x[\da-f]+);/gi, entity => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[entity.toLowerCase()] ?? String.fromCodePoint(parseInt(entity.slice(entity[2].toLowerCase()==='x'?3:2,-1),entity[2].toLowerCase()==='x'?16:10))));
}
/** Pair adjacent source-language and English cues; never translate or invent words. */
export function originalEnglishDialogue(source) {
  const result = []; let translation;
  for (const line of plainScript(source).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cue = speech(line);
    if (!cue) { translation = undefined; continue; }
    if (han.test(cue.text)) { translation = cue; continue; }
    if (!/[A-Za-z]/.test(cue.text)) { translation = undefined; continue; }
    result.push({ ...cue, aliases: [...new Set([cue.speaker, ...(translation ? [translation.speaker] : [])])], ...(translation ? { translation: translation.text } : {}) });
    translation = undefined;
  }
  return result;
}
function dialogueCues(value) {
  return String(value || '').replace(/\\r\\n|\\n/g,'\n').split(/\r?\n/).flatMap(line => {
    const cue = speech(line); return cue ? [cue] : [];
  });
}
export function lockDialogueToOriginal(dialogue, source) {
  const cues = dialogueCues(dialogue), originals = originalEnglishDialogue(source);
  if (!cues.length) {
    if (!String(dialogue || '').trim() || /^(?:无(?:对白|台词)|没有对白|none|no dialogue)[。.!]?$/i.test(String(dialogue).trim())) return '';
    throw Error('无法识别本镜头的说话人，请从原稿选择英文原句');
  }
  return cues.map(cue => {
    const matches = originals.filter(original => original.aliases.some(alias => speakerKey(alias) === speakerKey(cue.speaker)) && [original.text, original.translation].some(text => text && clean(text) === clean(cue.text)));
    const distinct = new Map(matches.map(original => [speakerKey(original.speaker)+'\0'+clean(original.text), original]));
    if (distinct.size !== 1) throw Error(`角色“${cue.speaker}”的台词无法唯一对应原稿英文，请先核对原句，不自动翻译或改写`);
    const original = [...distinct.values()][0];return `${original.speaker}：${original.text}`;
  }).join('\n');
}
function grouped(cues, aliases) {
  const result=[];
  for (const cue of cues) {
    const key = aliases?.get(speakerKey(cue.speaker)) || speakerKey(cue.speaker);
    const last=result.at(-1);
    if(last?.speaker===key) last.text=clean(last.text+' '+cue.text);
    else result.push({speaker:key,text:clean(cue.text)});
  }
  return result;
}
export function assertOriginalEnglishRows(rows, originals) {
  const aliases=new Map();
  for(const cue of originals) for(const alias of cue.aliases || [cue.speaker]) aliases.set(speakerKey(alias),speakerKey(cue.speaker));
  const expected=grouped(originals,aliases),actual=grouped(rows.flatMap(row=>dialogueCues(row.dialogue)),aliases);
  if(actual.some(cue=>han.test(cue.text)) || actual.length!==expected.length || expected.some((cue,index)=>cue.speaker!==actual[index]?.speaker||cue.text!==actual[index]?.text)) throw Error('分镜对白未逐字沿用本批原稿英文，未导入。请核对原英文台词，不重新翻译或润色');
}
export function assertLockedEnglishPrompt(dialogue, prompt) {
  const section=String(prompt).split('【声音设计】')[1]?.split(/【[^】]+】/)[0];
  if(section==null) throw Error('视频提示词缺少可核对的声音设计');
  const header=section.match(/(?:^|\n)\s*对白(?:[（(][^）)\n]*[）)])?\s*[：:]/);
  const body=header?section.slice(header.index+header[0].length):section;
  const expected=grouped(dialogueCues(dialogue)),actual=grouped(dialogueCues(body));
  if(actual.some(cue=>han.test(cue.text))||actual.length!==expected.length||expected.some((cue,index)=>cue.speaker!==actual[index]?.speaker||cue.text!==actual[index]?.text)) throw Error('视频提示词中的演出台词与原英文不一致，请先修正，未提交视频生成');
}
