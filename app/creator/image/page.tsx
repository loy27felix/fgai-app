import { redirect } from 'next/navigation';
import CreatorImageWorkspace from '@/components/creator/CreatorImageWorkspace';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function CreatorImagePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return <CreatorImageWorkspace userEmail={user.email || ''} />;
}
