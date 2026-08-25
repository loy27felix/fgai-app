import { redirect } from 'next/navigation';
import CreatorWorkspace from '@/components/creator/CreatorWorkspace';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import type { CreatorMessage, CreatorSession } from '@/lib/creator/types';
import { createClient } from '@/lib/local/server';

export const dynamic = 'force-dynamic';

type PageProps = { searchParams: { session?: string | string[] } };

export default async function ChatPage({ searchParams }: PageProps) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await ensureCreatorWorkspace({
    rpc: async () => localClient.rpc('ensure_creator_workspace'),
    load: async (id) => localClient.from('creator_workspaces').select('*').eq('id', id).single(),
  }, user.id);
  const sessionsResult = await localClient
    .from('creator_sessions')
    .select('*')
    .eq('workspace_id', workspace.id)
    .eq('kind', 'chat')
    .is('archived_at', null)
    .order('updated_at', { ascending: false });
  const sessions = (sessionsResult.data || []) as CreatorSession[];
  const requestedSessionId = typeof searchParams.session === 'string' ? searchParams.session : null;
  const initialSessionId = requestedSessionId && sessions.some((session) => session.id === requestedSessionId)
    ? requestedSessionId
    : null;
  const messages: CreatorMessage[] = initialSessionId
    ? ((await localClient.from('creator_messages').select('*').eq('session_id', initialSessionId).order('created_at', { ascending: true })).data || []) as CreatorMessage[]
    : [];

  return <CreatorWorkspace userEmail={user.email || '创作者'} initialSessions={sessions} initialMessages={messages} initialSessionId={initialSessionId} />;
}
