import { http } from "./request";
import { applyProjectLanguage, normalizeProjectLanguage, projectLanguageTemplateVariables, type ProjectLanguagePolicy } from "@/lib/project-language-contract.mjs";
export { originalEnglishDialogue, lockDialogueToOriginal, assertOriginalEnglishRows, assertLockedEnglishPrompt, projectLanguageInstructions } from "@/lib/project-language-contract.mjs";
export type { OriginalEnglishCue } from "@/lib/project-language-contract.mjs";
export { applyProjectLanguage, normalizeProjectLanguage };
export type { ProjectLanguagePolicy };
export type ProjectLanguageSetting = { policy: ProjectLanguagePolicy; revision: string | null };
export async function getProjectLanguage(projectId?: string): Promise<ProjectLanguageSetting> {
    // Native IDs only. Other workspaces keep their existing behavior; tests have no browser session.
    if (typeof window === "undefined" || !/^[0-9a-f-]{32,36}$/i.test(projectId || "")) return { policy: normalizeProjectLanguage(), revision: null };
    return http.get<ProjectLanguageSetting>(`/fg/project-language/${projectId}`);
}
export function saveProjectLanguage(projectId: string, setting: ProjectLanguageSetting, policy: ProjectLanguagePolicy) {
    return http.put<ProjectLanguageSetting>(`/fg/project-language/${projectId}`, { policy: normalizeProjectLanguage(policy), expectedRevision: setting.revision });
}
export async function projectLanguageTaskInput<T extends { projectId?: string; prompt: string; type?: string; input?: Record<string, unknown> }>(body: T): Promise<T> {
    const setting = await getProjectLanguage(body.projectId);
    const metadata = (body.input?.metadata || {}) as Record<string, unknown>;
    if (metadata.projectLanguagePolicy && JSON.stringify(normalizeProjectLanguage(metadata.projectLanguagePolicy)) !== JSON.stringify(setting.policy)) throw new Error("项目语言设置已变化，请重新预览生成内容");
    if (setting.policy.spoken === "source" && setting.policy.screenText === "source") return body;
    const mode = String(body.input?.mode || body.type?.replace(/^canvas_/, "") || "text");
    const variables = metadata.promptTemplateVariables as Record<string, string> | undefined;
    return { ...body, prompt: applyProjectLanguage(body.prompt, setting.policy, mode), input: { ...body.input,
        ...(typeof body.input?.prompt === "string" ? { prompt: applyProjectLanguage(body.input.prompt, setting.policy, mode) } : {}),
        requirements: applyProjectLanguage(String(body.input?.requirements || ""), setting.policy, mode),
        metadata: { ...metadata, projectLanguagePolicy: setting.policy,
            ...(metadata.artifactMetadata && typeof metadata.artifactMetadata === "object" ? { artifactMetadata: { ...metadata.artifactMetadata, actualPrompt: applyProjectLanguage(body.prompt, setting.policy, mode), projectLanguagePolicy: setting.policy } } : {}),
            ...(variables ? { promptTemplateVariables: projectLanguageTemplateVariables(variables, setting.policy, mode) } : {}) },
    } };
}
