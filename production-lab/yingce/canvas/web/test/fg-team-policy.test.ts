import { expect, test } from "bun:test";
import { storageCapacityAlert } from "../src/lib/storage-capacity-alert";
import { microphoneErrorMessage } from "../src/lib/microphone-error";

test("NAS alerts start at 80 and escalate at 90; missing or invalid samples never look healthy", () => {
    expect(storageCapacityAlert({ available: true, usagePercent: 79.99 })).toBeNull();
    expect(storageCapacityAlert({ available: true, usagePercent: 80 })?.type).toBe("warning");
    expect(storageCapacityAlert({ available: true, usagePercent: 89.99 })?.type).toBe("warning");
    expect(storageCapacityAlert({ available: true, usagePercent: 90 })?.type).toBe("error");
    expect(storageCapacityAlert({ available: false, usagePercent: 99 })).toBeNull();
    expect(storageCapacityAlert({ available: true, usagePercent: NaN })).toBeNull();
});

test("microphone permissions, missing hardware and occupied hardware have actionable messages", () => {
    for (const [name, hint] of [["NotAllowedError", "请允许"], ["SecurityError", "请允许"], ["NotFoundError", "未找到"], ["NotReadableError", "被占用"]]) {
        const error = new Error("Permission denied"); error.name = name;
        expect(microphoneErrorMessage(error)).toContain(hint);
        expect(microphoneErrorMessage(error)).not.toContain("Permission");
    }
    expect(microphoneErrorMessage(null)).toContain("HTTPS");
});
