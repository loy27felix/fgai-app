import {expect,test} from 'bun:test';
import {dramaDialoguePreserved} from '@/lib/short-drama-dialogue';
test('时间与表演制作说明不增加对白；原句仍必须保留',()=>{
 const dialogue='病人：Where did you put my notebook?';
 const prompt=`【声音设计】\n对白：\n病人：Where did you put my notebook?\n时间与表演：0—4秒压低声音说完，4—8秒停顿与呼吸，尾段不新增对白。\n【负面约束】\n不换脸。`;
 expect(dramaDialoguePreserved(dialogue,prompt)).toBe(true);
 expect(dramaDialoguePreserved(dialogue,prompt.replace('Where did you put my notebook?','Give me the notebook.'))).toBe(false);
 expect(dramaDialoguePreserved(dialogue,prompt.replace('【负面约束】','护士：I threw it away.\n【负面约束】'))).toBe(false);
});
