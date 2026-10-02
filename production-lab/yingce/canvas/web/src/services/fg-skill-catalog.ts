import {addSkill, listAddedSkills, listSkills, type Skill} from '@/services/api/skills';

type CatalogDependencies = {
    list: typeof listSkills;
    added: typeof listAddedSkills;
    add: typeof addSkill;
};

export function createFGSkillCatalog(deps: CatalogDependencies = {list: listSkills, added: listAddedSkills, add: addSkill}) {
    async function readPages(scope: 'public' | 'created') {
        const skills: Skill[] = [];
        for (let page = 1; ; page++) {
            const result = await deps.list({scope, page, pageSize: 80});
            skills.push(...result.skills);
            if (!result.hasMore) return skills;
        }
    }

    return {
        async list() {
            const [publicSkills, ownSkills, added] = await Promise.all([readPages('public'), readPages('created'), deps.added()]);
            return [...new Map([...publicSkills, ...ownSkills, ...added.skills].map(skill => [skill.skillId, skill])).values()];
        },
        async activate(ids: string[], catalog: Skill[]) {
            const byId = new Map(catalog.map(skill => [skill.skillId, skill]));
            const selected = [...new Set(ids)].map(id => {
                const skill = byId.get(id);
                if (!skill) throw new Error('技能已下架，请刷新技能列表');
                return skill;
            });
            if (selected.length > 4) throw new Error('每次最多选择 4 个制作技能');
            // Only explicit choices enter the user's library. Loading the catalog never installs skills.
            for (const skill of selected) if (!skill.isAdded) await deps.add(skill.skillId);
            const installed = await deps.added();
            const active = new Map(installed.skills.map(skill => [skill.skillId, skill]));
            return selected.map(skill => {
                const saved = active.get(skill.skillId);
                if (!saved?.isAdded) throw new Error(`技能「${skill.skillName}」未加载成功，请重试`);
                return {...skill, ...saved};
            });
        },
    };
}

export const fgSkillCatalog = createFGSkillCatalog();
