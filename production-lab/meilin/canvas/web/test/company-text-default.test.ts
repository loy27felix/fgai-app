import { expect, test } from "bun:test";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";
test("company Sol becomes the default once while preserving later explicit text selection", () => {
    const channels = [createModelChannel({ id: "company", name: "Company", apiFormat: "openai", baseUrl: "https://example.invalid/v1", apiKey: "test", models: ["gpt-6.1-sol", "claude-sonnet-5-5-t3a"] })];
    const old = { ...defaultConfig, channels, textModel: "company::claude-sonnet-5-5-t3a", fgTextDefaultRevision: 1 };
    const migrated = normalizeConfigSnapshot({ config: old }).config;
    expect(migrated.textModel).toBe("company::gpt-6.1-sol");
    expect(migrated.fgTextDefaultRevision).toBe(2);
    const explicit = normalizeConfigSnapshot({ config: { ...migrated, textModel: "company::claude-sonnet-5-5-t3a" } }).config;
    expect(explicit.textModel).toBe("company::claude-sonnet-5-5-t3a");
});
