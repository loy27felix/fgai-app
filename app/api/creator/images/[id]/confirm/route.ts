import { createImageConfirmHandlers } from '@/lib/creator/image-confirm-route';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/supabase/server';
import { confirmCreatorImage } from '@/lib/creator/image-service';

export const runtime = 'nodejs';
export const maxDuration = 120;

const defaultImageConfirmHandlers = createImageConfirmHandlers({
  createClient,
  ensureCreatorWorkspace,
  confirmCreatorImage,
});

export const POST = defaultImageConfirmHandlers.POST;
