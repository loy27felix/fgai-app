import { http } from "./request";

export type FeishuFeedbackSettings = {
    enabled: boolean; appId: string; baseUrl: string; adminChatId: string;
    timezone: string; digestHour: number; digestMinute: number;
    appSecretSet: boolean; verificationTokenSet: boolean; encryptKeySet: boolean;
};
export type FeishuFeedbackInput = Pick<FeishuFeedbackSettings, "enabled" | "appId" | "baseUrl" | "adminChatId" | "timezone" | "digestHour" | "digestMinute"> & {
    appSecret?: string; verificationToken?: string; encryptKey?: string;
};
export const getFeishuFeedbackSettings = () => http.get<FeishuFeedbackSettings>("/admin/integrations/feishu");
export const saveFeishuFeedbackSettings = (value: FeishuFeedbackInput) => http.put<FeishuFeedbackSettings>("/admin/integrations/feishu", value);
export const previewFeishuFeedbackDigest = () => http.get<{date: string; count: number; text: string}>("/admin/integrations/feishu/preview");
