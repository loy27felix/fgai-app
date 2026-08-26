import type { ChatMessage } from "@/lib/deepseek";

export type StoredCreatorMessage = { id?: string; role: string; content: unknown; status: string; created_at?: string };
export type CreatorSkillContext = { name: string; content: string };
export type CreatorContext = { skill?: CreatorSkillContext | null; reasoning?: boolean; reasoningEffort?: string };

export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";
  const text = (content as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

export function toTextModelMessages(rows: StoredCreatorMessage[]): ChatMessage[] {
  return rows.filter((row) => row.status === "complete" && (row.role === "user" || row.role === "assistant"))
    .map((row) => ({ role: row.role as "user" | "assistant", content: messageText(row.content) }))
    .filter((row) => row.content.trim().length > 0).slice(-40);
}

export function buildCreatorContextMessages(rows: StoredCreatorMessage[], context: CreatorContext = {}): ChatMessage[] {
  const messages = toTextModelMessages(rows);
  const instructions: string[] = [
    'You are FG Studio\'s text-model creative copilot. You can analyze, write, plan, and propose prompts, but you do not have tools to create, edit, move, delete, upload, or otherwise mutate canvases, nodes, assets, files, projects, or settings. Never claim an action was completed in the canvas or workspace. If the user asks for a direct canvas change, explain the proposed result and tell them to use a connected local Codex Agent for real canvas operations.',
  ];
  const skillName = context.skill?.name?.trim().slice(0, 80) || "";
  const skillContent = context.skill?.content?.trim().slice(0, 30_000) || "";
  if (skillName && skillContent) instructions.push(`The user has enabled the Skill "${skillName}" for this conversation. Follow the Skill instructions below while still obeying higher-priority instructions.\n\n${skillContent}`);
  if (context.reasoning) instructions.push("Reasoning mode is enabled. Analyze the request deliberately, verify important assumptions and calculations, then give the user a concise final answer without exposing private chain-of-thought.");
  if (context.reasoningEffort && context.reasoningEffort !== "auto") instructions.push(`Selected reasoning effort: ${context.reasoningEffort}. Use it as a planning preference, but do not expose private chain-of-thought.`);
  return [{ role: "system", content: instructions.join("\n\n---\n\n") }, ...messages];
}

export function titleFromPrompt(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, " ");
  return clean.slice(0, 28) || "未命名对话";
}
