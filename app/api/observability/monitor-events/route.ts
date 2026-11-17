import { GET as monitorGET, POST as monitorPOST } from '@/lib/observability/monitor-api';

export const runtime = 'nodejs';
export const GET = monitorGET;
export const POST = monitorPOST;
