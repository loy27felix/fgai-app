import { scopedLocalStorage } from "@/lib/user-scope";
import { buildCameraPrompt, type CameraControlOptions } from "./camera-prompt-library";

export const DEFAULT_CAMERA_CONTROL: CameraControlOptions = { enabled: false, camera: "arri_alexa_mini_lf", lens: "arri_signature_prime", focalLength: 50, aperture: 2.8 };
const STORAGE_KEY = "canvas:last-applied-camera-control:v1";

export function readCameraControlPreference(): CameraControlOptions | undefined {
    try {
        const raw = scopedLocalStorage.getItem(STORAGE_KEY);
        if (!raw) return undefined;
        const value = JSON.parse(raw) as CameraControlOptions;
        if (!value || typeof value.enabled !== "boolean") return undefined;
        buildCameraPrompt({ cameraId: value.camera, lensId: value.lens, focalLengthMm: value.focalLength, apertureF: value.aperture });
        return { enabled: value.enabled, camera: value.camera, lens: value.lens, focalLength: value.focalLength, aperture: value.aperture };
    } catch { return undefined; }
}

export function resolveCameraControl(options?: CameraControlOptions): CameraControlOptions | undefined {
    return options ?? readCameraControlPreference();
}

export function writeCameraControlPreference(options: CameraControlOptions): boolean {
    try {
        buildCameraPrompt({ cameraId: options.camera, lensId: options.lens, focalLengthMm: options.focalLength, apertureF: options.aperture });
        scopedLocalStorage.setItem(STORAGE_KEY, JSON.stringify(options));
        return true;
    } catch { return false; }
}
