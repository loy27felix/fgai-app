import { http } from "@/services/api/request";
import type { SkinDefinition } from "@/lib/skin-themes";
import type { CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { apiBaseURL } from "@/services/api/request";
import { DEFAULT_CANVAS_APPEARANCE } from "@/lib/canvas/agent-appearance";

import type { UpdateAnnouncement } from "@/lib/update-announcement";

export type PublicAppearance = {
    updates?: UpdateAnnouncement;
    canvas?: CanvasAppearance;
    schemaVersion: number;
    brandName: string;
    brandSlug: string;
    authHeroTitle: string;
    authHeroDescription: string;
    logoUrl: string;
    darkLogoUrl: string;
    logoFrameEnabled: boolean;
    authVideoUrl: string;
    authVideoPosterUrl: string;
    authVideoAutoplay: boolean;
    skinId: string;
    activeSkin: SkinDefinition;
    seoTitle: string;
    seoDescription: string;
    seoKeywords: string;
    footerCopyright: string;
    icpFilingEnabled: boolean;
    icpFilingNumber: string;
    redeemPurchaseUrl: string;
    logoConfigured: boolean;
    darkLogoConfigured: boolean;
    authVideoConfigured: boolean;
    authVideoPosterConfigured: boolean;
    configured: boolean;
    revision: string;
    updatedAt?: string;
};

export type AdminAppearance = {
    updates?: UpdateAnnouncement;
    canvas?: CanvasAppearance;
    schemaVersion: number;
    brandName: string;
    brandSlug: string;
    authHeroTitle: string;
    authHeroDescription: string;
    logoResourceId: string;
    darkLogoResourceId: string;
    logoFrameEnabled: boolean;
    authVideoResourceId: string;
    authVideoPosterResourceId: string;
    authVideoAutoplay: boolean;
    skinId: string;
    skinThemes: SkinDefinition[];
    seoTitle: string;
    seoDescription: string;
    seoKeywords: string;
    footerCopyright: string;
    icpFilingEnabled: boolean;
    icpFilingNumber: string;
    redeemPurchaseUrl: string;
    public: PublicAppearance;
    configured: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type AppearanceAssetSlot = "logo" | "logo-dark" | "video" | "poster";

export type AppearanceResource = {
    id: string;
    kind: string;
    status: string;
    mimeType: string;
    size: number;
};

export async function getPublicAppearance(signal?: AbortSignal) {
    const result = await http.get<{ appearance: PublicAppearance }>("/public/appearance", { signal });
    return result.appearance;
}

export async function getAdminAppearance(signal?: AbortSignal) {
    const result = await http.get<{ setting: AdminAppearance }>("/admin/settings/appearance", { signal });
    return result.setting;
}

export async function updateAdminAppearance(
    input: Pick<
        AdminAppearance,
        | "brandName"
        | "canvas"
        | "updates"
        | "brandSlug"
        | "authHeroTitle"
        | "authHeroDescription"
        | "logoResourceId"
        | "darkLogoResourceId"
        | "logoFrameEnabled"
        | "authVideoResourceId"
        | "authVideoPosterResourceId"
        | "authVideoAutoplay"
        | "skinId"
        | "skinThemes"
        | "seoTitle"
        | "seoDescription"
        | "seoKeywords"
        | "footerCopyright"
        | "icpFilingEnabled"
        | "icpFilingNumber"
        | "redeemPurchaseUrl"
    >,
) {
    const result = await http.patch<{ setting: AdminAppearance }>("/admin/settings/appearance", input);
    return result.setting;
}

export async function resetAdminAppearance() {
    const current = await getAdminAppearance();
    return updateAdminAppearance({
        ...current, brandName: "FG", brandSlug: "fg-studio",
        canvas: DEFAULT_CANVAS_APPEARANCE,
        logoResourceId: "", darkLogoResourceId: "", logoFrameEnabled: true,
        authHeroTitle: "让一个故事，\n从文字走向银幕。", authHeroDescription: "",
        authVideoResourceId: "", authVideoPosterResourceId: "",
        seoTitle: "FG Studio", seoDescription: "FG Studio · AI 影视与漫剧制作工作台", seoKeywords: "FG,影视,漫剧,制作,画布",
        footerCopyright: `© ${new Date().getFullYear()} FG Studio`, icpFilingEnabled: false, icpFilingNumber: "",
    });
}

export async function uploadAppearanceAsset(slot: AppearanceAssetSlot | "update-image" | "update-video", file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ resource: AppearanceResource }>(`/admin/settings/appearance/assets/${slot}`, body);
    return result.resource;
}

export function updateAnnouncementPreviewURL(resourceId: string) {
    return `${apiBaseURL.replace(/\/$/, "")}/admin/settings/appearance/updates/${encodeURIComponent(resourceId)}`;
}

export async function uploadLive2D(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ model: { resourceId: string; entry: string } }>("/admin/settings/appearance/live2d", body);
    return result.model;
}

export function live2DModelURL(resourceId: string, entry: string, preview = false) {
    return `${apiBaseURL.replace(/\/$/, "")}/${preview ? "admin/settings" : "public"}/appearance/live2d/${encodeURIComponent(resourceId)}/${entry.split("/").map(encodeURIComponent).join("/")}`;
}
