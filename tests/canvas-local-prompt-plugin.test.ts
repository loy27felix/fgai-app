import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("local prompt studio plugin is discoverable and supplies a scalable canvas editor", () => {
    const index = JSON.parse(read("public/plugins/index.json")) as string[];
    const plugin = read("public/plugins/prompt-studio.plugin.js");
    const node = read("reference/infinite-canvas/src/components/canvas/canvas-node.tsx");

    assert.ok(index.includes("/plugins/prompt-studio.plugin.js"));
    assert.match(plugin, /id:\s*PLUGIN_ID/);
    assert.match(plugin, /title:\s*"可缩放提示词工作台"/);
    assert.match(plugin, /defaultSize:\s*\{\s*width:\s*820,\s*height:\s*360\s*\}/);
    assert.match(plugin, /textarea/);
    assert.match(plugin, /updateMetadata/);
    assert.match(node, /definition\?\.Panel \? "w-\[min\(960px/);
});
