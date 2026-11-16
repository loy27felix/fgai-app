import { expect, test } from "bun:test";
import { characterTurnaroundConfig } from "../src/pages/projects/detail/project-character-media";
import { defaultConfig } from "../src/stores/use-config-store";

test("turnaround starts with image-model defaults rather than the last canvas custom size", () => {
    const stored = { ...defaultConfig, imageModel: "gpt-image-2", model: "video-model", size: "*", count: "4", taskWorkflowProvider: "runninghub" as const };
    const current = characterTurnaroundConfig(stored);
    expect(current.model).toBe("gpt-image-2");
    expect(current.imageModel).toBe(current.model);
    expect(current.size).not.toBe("*");
    expect(current.size.length).toBeGreaterThan(0);
    expect(current.count).toBe("1");
    expect(current.taskWorkflowProvider).toBe("model");
    expect(stored.size).toBe("*");
    expect(stored.count).toBe("4");
});
