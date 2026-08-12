import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const catalogSource = fs.readFileSync(path.join(root, "lib", "skillData.ts"), "utf8");

const expectedSkills = [
  ["screenwriting", "screenwriting.md", "# DeepWhite"],
  ["emotion-director", "emotion-director.md", "# Seedance"],
  ["shotlist", "shotlist-builder.md", "#"],
  ["imageprompt", "image-prompt-builder.md", "#"],
  ["seedance", "seedance-director.md", "#"],
  ["seedance-combat", "seedance-combat-prompt.md", "# Seedance 二次元打戏"],
  ["cinematic-realism", "zy-cinematic-realism.md", "# 造梦师 · 电影真实感"],
  ["screenwriter", "screenwriter.md", "#"],
] as const;

test("workflow skill catalog exposes every approved local workflow skill", () => {
  for (const [id, file, marker] of expectedSkills) {
    assert.match(catalogSource, new RegExp(`id: "${id}"`));
    assert.match(catalogSource, new RegExp(`file: "${file}"`));

    const content = fs.readFileSync(path.join(root, "public", "skills", file), "utf8");
    assert.match(content, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(content.length <= 30_000, `${file} must remain inside the server skill-context limit`);
  }
});
