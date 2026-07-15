import type { CreatorWorkspace } from './types';

type WorkspaceError = { message: string };

export type WorkspaceClient = {
  rpc(): Promise<{ data: string | null; error: WorkspaceError | null }>;
  load(id: string): Promise<{ data: CreatorWorkspace | null; error: WorkspaceError | null }>;
};

export async function ensureCreatorWorkspace(
  client: WorkspaceClient,
  userId: string,
): Promise<CreatorWorkspace> {
  const ensured = await client.rpc();
  if (ensured.error || !ensured.data) {
    throw new Error(ensured.error?.message || 'workspace bootstrap failed');
  }

  const loaded = await client.load(ensured.data);
  if (loaded.error || !loaded.data) {
    throw new Error(loaded.error?.message || 'workspace load failed');
  }
  if (loaded.data.owner_id !== userId) {
    throw new Error('workspace ownership mismatch');
  }
  return loaded.data;
}
