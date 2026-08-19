import { createImageConfirmHandlers } from '@/lib/creator/image-confirm-route';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/local/server';
import { confirmCreatorImage } from '@/lib/creator/image-service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const defaultImageConfirmHandlers = createImageConfirmHandlers({
  createClient,
  ensureCreatorWorkspace,
  confirmCreatorImage,
});

export const POST = defaultImageConfirmHandlers.POST;
