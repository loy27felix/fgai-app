import { redirect } from 'next/navigation';
import CreatorVideoWorkspace from '@/components/creator/CreatorVideoWorkspace';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function CreatorVideoPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return <CreatorVideoWorkspace userEmail={user.email || ''} />;
}