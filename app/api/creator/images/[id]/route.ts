import { confirmImageReferenceUploads, deleteOwnedImageTask } from '@/lib/creator/imageStorage';
import { createImageItemHandlers } from '@/lib/creator/image-item-route';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/local/server';

export const runtime = 'nodejs';

const defaultImageItemHandlers = createImageItemHandlers({
  createClient,
  ensureCreatorWorkspace,
  confirmImageReferenceUploads,
  deleteOwnedImageTask,
});

export async function PATCH(req: Request, context: { params: { id: string } }) {
  return defaultImageItemHandlers.PATCH(req, context);
}

export async function DELETE(req: Request, context: { params: { id: string } }) {
  return defaultImageItemHandlers.DELETE(req, context);
}
