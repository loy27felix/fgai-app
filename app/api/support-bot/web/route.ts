import { createClient } from '@/lib/local/server';
import { supportWebGET, supportWebPOST } from '@/lib/support-bot/web-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function userId() {
  const { data: { user } } = await createClient().auth.getUser();
  return user?.id;
}

export function GET(request: Request) {
  return supportWebGET(request, userId);
}

export function POST(request: Request) {
  return supportWebPOST(request, userId);
}
