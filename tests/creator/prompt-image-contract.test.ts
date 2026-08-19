import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { normalizeGitHubImageUrl, toPromptImageUrl } from "../../reference/infinite-canvas/src/services/api/prompt-image-url";

test("prompt source images are routed through the same-origin proxy", () => {
  const proxied = toPromptImageUrl("https://github.com/acme/prompts/blob/main/images/cover.png");
  assert.equal(proxied.startsWith("/api/creator/prompt-image?url="), true);
  assert.equal(
    decodeURIComponent(proxied.split("=").slice(1).join("=")),
    "https://raw.githubusercontent.com/acme/prompts/main/images/cover.png",
  );
  assert.equal(toPromptImageUrl("data:image/png;base64,abc"), "data:image/png;base64,abc");
  assert.equal(toPromptImageUrl("/local-cover.png"), "/local-cover.png");
});

test("github blob links normalize to raw content before proxying", () => {
  assert.equal(
    normalizeGitHubImageUrl(new URL("https://github.com/acme/prompts/blob/main/images/cover.png")).toString(),
    "https://raw.githubusercontent.com/acme/prompts/main/images/cover.png",
  );
});

test("prompt image proxy is authenticated and blocks non-public targets", () => {
  const route = fs.readFileSync(path.join(process.cwd(), "app/api/creator/prompt-image/route.ts"), "utf8");
  assert.match(route, /localClient\.auth\.getUser/);
  assert.match(route, /url\.protocol !== "http:"/);
  assert.match(route, /MAX_IMAGE_BYTES/);
});
