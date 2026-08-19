import { NextResponse } from 'next/server';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/local/server';

export const runtime = 'nodejs';

async function handle() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const workspace = await ensureCreatorWorkspace({
      rpc: async () => localClient.rpc('ensure_creator_workspace'),
      load: async (id) => localClient
        .from('creator_workspaces')
        .select('*')
        .eq('id', id)
        .single(),
    }, user.id);
    return NextResponse.json({ workspace });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '私人空间初始化失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
