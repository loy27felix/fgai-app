// Chat history persistence via the local browser client
// 对话历史通过本地浏览器客户端存取，服务端按 user_id 限制为本人
export type ChatSession = { id: string; title: string | null; updated_at: string };

export async function listSessions(sb: any, projectId: string, scope: string): Promise<ChatSession[]> {
  const { data } = await sb.from("chat_sessions").select("id,title,updated_at")
    .eq("project_id", projectId).eq("scope", scope).order("updated_at", { ascending: false }).limit(50);
  return (data || []) as ChatSession[];
}
export async function loadSession(sb: any, id: string): Promise<any[]> {
  const { data } = await sb.from("chat_sessions").select("messages").eq("id", id).single();
  return (data?.messages || []) as any[];
}
export async function deleteSession(sb: any, id: string) {
  await sb.from("chat_sessions").delete().eq("id", id);
}
export async function upsertSession(sb: any, p: { id?: string | null; projectId: string; scope: string; title: string; messages: any[] }): Promise<string | null> {
  if (p.id) {
    await sb.from("chat_sessions").update({ messages: p.messages, updated_at: new Date().toISOString() }).eq("id", p.id);
    return p.id;
  }
  const { data } = await sb.from("chat_sessions")
    .insert({ project_id: p.projectId, scope: p.scope, title: (p.title || "未命名对话").slice(0, 40), messages: p.messages })
    .select("id").single();
  return (data?.id as string) || null;
}
