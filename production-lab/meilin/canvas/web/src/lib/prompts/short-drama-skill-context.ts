import assetSkill from "./short-drama-skills/short-drama-asset-prompts/SKILL.md?raw";
import assetTemplates from "./short-drama-skills/short-drama-asset-prompts/references/public-asset-templates.md?raw";
import videoSkill from "./short-drama-skills/script-to-drama-prompt-dev/SKILL.md?raw";
import directorFormat from "./short-drama-skills/script-to-drama-prompt-dev/references/director-prompt-format.md?raw";
import actionSkill from "./short-drama-skills/wuxi-action-director-public/SKILL.md?raw";

export const SHORT_DRAMA_BUILTIN_SKILLS = [
    {
        name: "short-drama-asset-prompts",
        files: [
            { path: "SKILL.md", content: assetSkill },
            { path: "references/public-asset-templates.md", content: assetTemplates },
        ],
    },
    {
        name: "script-to-drama-prompt-dev",
        files: [
            { path: "SKILL.md", content: videoSkill },
            { path: "references/director-prompt-format.md", content: directorFormat },
        ],
    },
];

function skillsFor(includeAction: boolean) {
    return includeAction ? [...SHORT_DRAMA_BUILTIN_SKILLS, { name: "wuxi-action-director-public", files: [{ path: "SKILL.md", content: actionSkill }] }] : SHORT_DRAMA_BUILTIN_SKILLS;
}

export function shortDramaAssetSkillContext() {
    const skill = SHORT_DRAMA_BUILTIN_SKILLS[0];
    return `<skill-context name="${skill.name}">\n${skill.files.map((file) => `<skill-file path="${file.path}">\n${file.content}\n</skill-file>`).join("\n\n")}\n</skill-context>`;
}

export function shortDramaSkillContext(includeAction = false) {
    return skillsFor(includeAction)
        .map((skill) => `<skill-context name="${skill.name}">\n${skill.files.map((file) => `<skill-file path="${file.path}">\n${file.content}\n</skill-file>`).join("\n\n")}\n</skill-context>`)
        .join("\n\n");
}

export async function shortDramaSkillProvenance(includeAction = false) {
    return Promise.all(
        skillsFor(includeAction).map(async (skill) => ({
            name: skill.name,
            files: await Promise.all(
                skill.files.map(async (file) => ({
                    path: file.path,
                    sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.content))))
                        .map((byte) => byte.toString(16).padStart(2, "0"))
                        .join(""),
                })),
            ),
        })),
    );
}
