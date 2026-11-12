import { http } from "./request";
import { apiBaseURL } from "./request";
import type { AgentAvatarBundleManifest, AgentAvatarState } from "@/lib/canvas/agent-appearance";

export type MeilinCompanion = { userId: string; name: string; resourceId: string; height: number; revision: number;
    avatarType?: "site" | "orb" | "image" | "live2d" | "bundle";
    live2dResourceId?: string; live2dEntry?: string; avatarBundleResourceId?: string;
    avatarClipStates?: Partial<Record<AgentAvatarState, string>>; orbColor?: string;
};

export async function uploadCompanionPackage(file: File, kind: "bundle" | "live2d") {
    const body = new FormData(); body.append("file", file);
    return http.post<{resourceId: string; entry?: string; manifest?: AgentAvatarBundleManifest}>(`/agent/companion/uploads/${kind}`, body);
}
export function companionAssetURL(kind: "bundle" | "live2d", id: string, file: string) {
    return `${apiBaseURL.replace(/\/$/, "")}/agent/companion/assets/${kind}/${encodeURIComponent(id)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

export const getMeilinCompanion = () => http.get<MeilinCompanion>("/agent/companion");
export const updateMeilinCompanion = (value: MeilinCompanion) => http.put<MeilinCompanion>("/agent/companion", value);
