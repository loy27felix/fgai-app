import assert from "node:assert/strict";
import test from "node:test";

import { mergeImportedChannel, normalizeImportedBaseUrl } from "../reference/infinite-canvas/src/lib/channel-import";
import { createModelChannel } from "../reference/infinite-canvas/src/stores/use-config-store";

test("channel imports normalize valid Base URLs and reject invalid values", () => {
    assert.equal(normalizeImportedBaseUrl("https://gateway.example/v1/?token=discard#discard"), "https://gateway.example/v1");
    assert.equal(normalizeImportedBaseUrl("localhost:3000"), null);
    assert.equal(normalizeImportedBaseUrl("ftp://gateway.example/v1"), null);
});

test("channel imports update only a matching Base URL and add all other endpoints", () => {
    const existing = createModelChannel({ id: "existing", name: "团队", baseUrl: "https://team.example/v1", apiKey: "old-key" });
    const personal = createModelChannel({ id: "personal", name: "个人", baseUrl: "https://personal.example/v1", apiKey: "personal-key" });

    const updated = mergeImportedChannel([existing, personal], "https://team.example/v1/", "new-key")!;
    assert.deepEqual(updated.map((channel) => channel.id), ["existing", "personal"]);
    assert.equal(updated[0].apiKey, "new-key");
    assert.equal(updated[1].apiKey, "personal-key");

    const added = mergeImportedChannel(updated, "https://other.example/v1", "other-key")!;
    assert.equal(added.length, 3);
    assert.equal(added[0].id, "existing");
    assert.equal(added[1].id, "personal");
    assert.equal(added[2].baseUrl, "https://other.example/v1");
    assert.equal(added[2].apiKey, "other-key");
});
