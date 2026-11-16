import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_CAMERA_CONTROL, readCameraControlPreference, resolveCameraControl, writeCameraControlPreference } from "../src/lib/canvas/camera-control-preferences";
import { buildCameraPrompt } from "../src/lib/canvas/camera-prompt-library";
import { setActiveUserScope } from "../src/lib/user-scope";
const values = new Map<string, string>();
let originalWindow: PropertyDescriptor | undefined;
beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    values.clear();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } } });
});
afterEach(() => { if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window"); });
const imax = { ...DEFAULT_CAMERA_CONTROL, enabled: true, camera: "imax_65mm_film", focalLength: 65, aperture: 5.6 };
test("IMAX is a film direction, preserves requested aspect and prohibits drawing equipment", () => {
    const prompt = buildCameraPrompt({ cameraId: imax.camera, lensId: imax.lens, focalLengthMm: imax.focalLength, apertureF: imax.aperture });
    expect(prompt).toContain("15-perforation 65mm horizontal film");
    expect(prompt).toContain("preserve the requested aspect ratio");
    expect(prompt).toContain("do not add any physical camera");
});
test("new nodes use last applied settings but explicit node settings including off take priority", () => {
    expect(resolveCameraControl()).toBeUndefined();
    expect(writeCameraControlPreference(imax)).toBe(true);
    expect(readCameraControlPreference()).toEqual(imax);
    expect(resolveCameraControl()).toEqual(imax);
    expect(resolveCameraControl(DEFAULT_CAMERA_CONTROL)).toEqual(DEFAULT_CAMERA_CONTROL);
    expect(writeCameraControlPreference({ ...imax, enabled: false })).toBe(true);
    expect(resolveCameraControl()?.enabled).toBe(false);
});
test("camera preferences stay isolated between accounts", () => {
    setActiveUserScope("member-a");
    writeCameraControlPreference(imax);
    setActiveUserScope("member-b");
    expect(readCameraControlPreference()).toBeUndefined();
    writeCameraControlPreference(DEFAULT_CAMERA_CONTROL);
    setActiveUserScope("member-a");
    expect(readCameraControlPreference()).toEqual(imax);
});
test("invalid stored selections and unavailable storage never break opening a new panel", () => {
    writeCameraControlPreference(imax);
    const key = [...values.keys()][0];
    values.set(key, '{"enabled":true,"camera":"deleted-camera"}');
    expect(readCameraControlPreference()).toBeUndefined();
    values.set(key, "not-json");
    expect(readCameraControlPreference()).toBeUndefined();
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
    expect(readCameraControlPreference()).toBeUndefined();
    expect(writeCameraControlPreference(imax)).toBe(false);
});
