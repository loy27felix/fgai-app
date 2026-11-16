import { expect, test } from "bun:test";
import { shortDramaAssetSkillContext, shortDramaSkillProvenance } from "../src/lib/prompts/short-drama-skill-context";

test("asset extraction gets both complete skill files without video direction", async () => {
    const context = shortDramaAssetSkillContext();
    for (const path of ["SKILL.md", "references/public-asset-templates.md"]) {
        const source = await Bun.file(new URL(`../src/lib/prompts/short-drama-skills/short-drama-asset-prompts/${path}`, import.meta.url)).text();
        expect(context).toContain(source);
    }
    expect(context).not.toContain('<skill-context name="script-to-drama-prompt-dev">');
    expect(context).not.toContain('<skill-context name="wuxi-action-director-public">');
    const provenance = (await shortDramaSkillProvenance()).find((entry) => entry.name === "short-drama-asset-prompts");
    expect(provenance?.files).toHaveLength(2);
    expect(provenance?.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
});
