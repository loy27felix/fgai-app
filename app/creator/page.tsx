import { redirect } from 'next/navigation';
import CreatorWorkspace from '@/components/creator/CreatorWorkspace';
import type { CreatorMessage, CreatorSession } from '@/lib/creator/types';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function CreatorPage({ searchParams }: { searchParams: { session?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await ensureCreatorWorkspace({
    rpc: async () => supabase.rpc('ensure_creator_workspace'),
    load: async (id) => supabase.from('creator_workspaces').select('*').eq('id', id).single(),
  }, user.id);
  const { data } = await supabase
    .from('creator_sessions')
    .select('*')
    .eq('workspace_id', workspace.id)
    .is('archived_at', null)
    .order('updated_at', { ascending: false });
  const sessions = (data || []) as CreatorSession[];
  const requested = typeof searchParams.session === 'string' ? searchParams.session : null;
  const sessionId = sessions.some((item) => item.id === requested) ? requested : sessions[0]?.id || null;
  let messages: CreatorMessage[] = [];
  if (sessionId) {
    const result = await supabase
      .from('creator_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    messages = (result.data || []) as CreatorMessage[];
  }

  return <CreatorWorkspace userEmail={user.email || ''} initialSessions={sessions} initialMessages={messages} initialSessionId={sessionId} />;
}
