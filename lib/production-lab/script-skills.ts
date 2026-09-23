// Server-side only. Text and references are packaged; no local skill script is executed.
import packages from "./skill-packages.server.json";
export function scriptSkillContext(ids:string[]) {
  if(ids.length>2 || new Set(ids).size!==ids.length)throw new Error("最多选择两个不同的编导 Skill");
  const selected=ids.map(id=>{const skill=packages.find(p=>p.id===id);if(!skill)throw new Error("该 Skill 尚未部署");return skill;});
  const text=selected.map(skill=>`<creative_skill id="${skill.id}" version="${skill.version}">\n${skill.files.map(file=>`--- ${file.path} ---\n${file.content}`).join("\n\n")}\n</creative_skill>`).join("\n\n");
  if(text.length>110000)throw new Error("所选 Skill 资料过多，请减少组合");
  return {text,versions:selected.map(s=>({id:s.id,version:s.version,files:s.files.length}))};
}
export const scriptSkillCatalog=packages.map(p=>({id:p.id,version:p.version,files:p.files.length}));
