import { http } from "@/services/api/request";

export type CanvasPromptShortcut = { id: string; name: string; prompt: string };
type ShortcutDraft = Pick<CanvasPromptShortcut, "name" | "prompt">;
type ShortcutsResponse = { shortcuts: CanvasPromptShortcut[] };
const path = "/fg/canvas/prompt-shortcuts";

export async function listCanvasPromptShortcuts(signal?: AbortSignal) {
    return (await http.get<ShortcutsResponse>(path, { signal })).shortcuts;
}

export async function saveCanvasPromptShortcut(input: ShortcutDraft, id?: string) {
    if (id) await http.patch<ShortcutsResponse>(`${path}/${encodeURIComponent(id)}`, input);
    else await http.post<ShortcutsResponse>(path, input);
}

export async function deleteCanvasPromptShortcut(id: string) {
    await http.delete<ShortcutsResponse>(`${path}/${encodeURIComponent(id)}`);
}
