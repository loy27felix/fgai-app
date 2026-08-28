import { redirect } from 'next/navigation';
import CreatorWorkspace from '@/components/creator/CreatorWorkspace';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { normalizeCreatorMessages, normalizeCreatorSessions } from '@/lib/creator/session-read';
import type { CreatorMessage, CreatorSession } from '@/lib/creator/types';
import { createClient } from '@/lib/local/server';
import { logServerEvent, logServerFailure } from '@/lib/observability/server-log';

export const dynamic = 'force-dynamic';

type PageProps = { searchParams: { session?: string | string[] } };

export default async function ChatPage({ searchParams }: PageProps) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect('/login');

  const requestedSessionId = typeof searchParams.session === 'string' ? searchParams.session : null;
  const traceId = crypto.randomUUID();
  let sessions: CreatorSession[] = [];
  let messages: CreatorMessage[] = [];
  let initialSessionId: string | null = null;
  let initialLoadError: string | null = null;

  try {
    const workspace = await ensureCreatorWorkspace({
      rpc: async () => localClient.rpc('ensure_creator_workspace'),
      load: async (id) => localClient.from('creator_workspaces').select('*').eq('id', id).single(),
    }, user.id);
    // Do not reference optional archive/update columns here: existing LAN
    // databases can be one migration behind while still containing valid chat.
    const sessionsResult = await localClient
      .from('creator_sessions')
      .select('*')
      .eq('workspace_id', workspace.id);
    if (sessionsResult.error) throw sessionsResult.error;
    sessions = normalizeCreatorSessions(sessionsResult.data || [], 'chat');
    initialSessionId = requestedSessionId && sessions.some((session) => session.id === requestedSessionId)
      ? requestedSessionId
      : null;
    if (initialSessionId) {
      const messagesResult = await localClient
        .from('creator_messages')
        .select('*')
        .eq('session_id', initialSessionId);
      if (messagesResult.error) throw messagesResult.error;
      messages = normalizeCreatorMessages(messagesResult.data || []);
    }
    logServerEvent('creator_chat_page', { traceId, feature: 'creator_chat', stage: 'initial_read_completed', actorId: user.id, sessionId: initialSessionId || undefined, rawSessionCount: (sessionsResult.data || []).length, sessionCount: sessions.length, messageCount: messages.length, compatibilityRead: true });
  } catch (error: unknown) {
    logServerFailure('creator_chat_page', error, { traceId, feature: 'creator_chat', stage: 'initial_read_failed', actorId: user.id, sessionId: requestedSessionId || undefined });
    initialLoadError = `对话历史暂时读取失败（追踪编号：${traceId.slice(0, 8)}）`;
  }

  return <CreatorWorkspace userEmail={user.email || '创作者'} initialSessions={sessions} initialMessages={messages} initialSessionId={initialSessionId} initialLoadError={initialLoadError} />;
}
