# AI Creator Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the private creator workspace database boundary, private storage policies, trustworthy usage ledger, and a minimal authenticated workspace API without changing any existing director UI.

**Architecture:** New `creator_*` tables and a private `creator-assets` bucket isolate projectless creation from existing project tables. Browser requests use the authenticated Supabase client for owner-scoped data, while billing writes use a server-only service-role client so users cannot forge cost records. Existing `/api/ai/chat` keeps its response contract and gains best-effort dual-write accounting.

**Tech Stack:** Next.js 14 Route Handlers, TypeScript 5.5, Supabase Postgres/RLS/Storage, `@supabase/ssr`, `@supabase/supabase-js`, Node test runner through `tsx --test`.

## Global Constraints

- Do not change the existing director UI, project routes, seven-stage workflow, or project data behavior.
- Do not create hidden director projects for private creator users.
- Keep the existing DeepSeek and Wetoken provider clients unchanged in this foundation phase.
- Never write the Wetoken Key, DeepSeek Key, Supabase service-role key, Authorization headers, or raw base64 into Git, browser bundles, database request snapshots, or logs.
- All migrations must be additive and backward compatible.
- `creator-assets` must be private; project asset storage remains unchanged.
- Billing distinguishes `reported`, `estimated`, and `unknown`; money uses `numeric`, never floating point.
- Run focused tests before each commit, then run the full suite and production build before pushing.
- Each independently verified task is committed and pushed to `origin/main`.

---

## File Structure

### New files

- `supabase/migrations/0003_creator_foundation.sql` — creator workspace, folder, session, message, canvas, asset, task, RLS, helper function, and private bucket policies.
- `supabase/migrations/0004_ai_usage_ledger.sql` — immutable per-request usage and cost ledger with owner/admin read policies.
- `lib/creator/types.ts` — shared creator-domain TypeScript types and task status constants.
- `lib/creator/workspace.ts` — dependency-injected `ensureCreatorWorkspace` helper.
- `lib/usage/types.ts` — usage, money, and price-snapshot types.
- `lib/usage/cost.ts` — deterministic cost calculation from a saved price snapshot.
- `lib/usage/ledger.ts` — server-only trusted ledger insert and text-usage mapping.
- `lib/supabase/admin.ts` — server-only service-role Supabase client.
- `app/api/creator/workspace/route.ts` — authenticated workspace bootstrap endpoint.
- `tests/creator/foundation-schema.test.ts` — migration contract assertions.
- `tests/creator/workspace.test.ts` — workspace helper idempotency and error behavior.
- `tests/usage/cost.test.ts` — exact decimal-unit cost tests.
- `tests/usage/ledger.test.ts` — mapping and best-effort persistence tests.

### Modified files

- `.env.example` — document `SUPABASE_SERVICE_ROLE_KEY` as server-only.
- `app/api/ai/chat/route.ts` — preserve current response while dual-writing trusted text usage.

---

### Task 1: Creator schema, RLS, and private storage

**Files:**
- Create: `tests/creator/foundation-schema.test.ts`
- Create: `supabase/migrations/0003_creator_foundation.sql`

**Interfaces:**
- Consumes: existing `public.profiles`, `public.projects`, `public.is_admin()`, Supabase Auth `auth.uid()`.
- Produces: `public.ensure_creator_workspace() returns uuid`; `public.owns_creator_workspace(uuid) returns boolean`; all `creator_*` tables; private bucket `creator-assets`.

- [ ] **Step 1: Write the failing migration contract test**

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.join(process.cwd(), 'supabase/migrations/0003_creator_foundation.sql');

test('creator foundation migration defines isolated private workspace data', () => {
  assert.equal(fs.existsSync(migrationPath), true);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const table of [
    'creator_workspaces', 'creator_folders', 'creator_sessions', 'creator_messages',
    'creator_canvases', 'creator_assets', 'creator_generation_tasks',
  ]) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql, /create or replace function public\.ensure_creator_workspace\(\)/);
  assert.match(sql, /create or replace function public\.owns_creator_workspace\(target_workspace_id uuid\)/);
  assert.match(sql, /values \('creator-assets', 'creator-assets', false\)/);
  assert.doesNotMatch(sql, /alter table public\.projects/);
  assert.doesNotMatch(sql, /alter table public\.project_members/);
});

test('all creator tables enable row level security', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const table of [
    'creator_workspaces', 'creator_folders', 'creator_sessions', 'creator_messages',
    'creator_canvases', 'creator_assets', 'creator_generation_tasks',
  ]) assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx tsx --test tests/creator/foundation-schema.test.ts`  
Expected: FAIL because `0003_creator_foundation.sql` does not exist.

- [ ] **Step 3: Create the additive migration**

Create `supabase/migrations/0003_creator_foundation.sql` with these exact schema decisions:

```sql
create table if not exists public.creator_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  name text not null default '我的创作空间',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.creator_workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.creator_workspaces(id) on delete cascade,
  folder_id uuid references public.creator_folders(id) on delete set null,
  kind text not null default 'chat' check (kind in ('chat','image','video')),
  title text not null default '未命名对话',
  default_model text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.creator_sessions(id) on delete cascade,
  role text not null check (role in ('system','user','assistant','tool')),
  content jsonb not null default '{}'::jsonb,
  status text not null default 'complete' check (status in ('draft','streaming','complete','failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.creator_canvases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.creator_workspaces(id) on delete cascade,
  session_id uuid references public.creator_sessions(id) on delete set null,
  folder_id uuid references public.creator_folders(id) on delete set null,
  kind text not null check (kind in ('image','video')),
  title text not null default '未命名画布',
  graph jsonb not null default '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.creator_workspaces(id) on delete cascade,
  session_id uuid references public.creator_sessions(id) on delete set null,
  kind text not null check (kind in ('image','video','audio','document')),
  source text not null check (source in ('upload','generation','project_copy')),
  name text not null,
  storage_path text not null,
  mime_type text,
  width integer,
  height integer,
  duration_ms bigint,
  thumbnail_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_generation_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.creator_workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.creator_sessions(id) on delete set null,
  canvas_id uuid references public.creator_canvases(id) on delete set null,
  node_id text,
  kind text not null check (kind in ('image','video')),
  provider text not null,
  model text not null,
  filter_off boolean not null default false,
  idempotency_key text not null unique,
  external_task_id text,
  status text not null default 'draft' check (status in ('draft','submitting','queued','running','succeeded','failed','expired','unknown')),
  request jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists creator_generation_tasks_external_idx
  on public.creator_generation_tasks(provider, external_task_id)
  where external_task_id is not null;
create index if not exists creator_sessions_workspace_updated_idx
  on public.creator_sessions(workspace_id, updated_at desc);
create index if not exists creator_canvases_workspace_updated_idx
  on public.creator_canvases(workspace_id, updated_at desc);
create index if not exists creator_assets_workspace_created_idx
  on public.creator_assets(workspace_id, created_at desc);
create index if not exists creator_tasks_workspace_status_idx
  on public.creator_generation_tasks(workspace_id, status, created_at desc);

create or replace function public.owns_creator_workspace(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.creator_workspaces w
    where w.id = target_workspace_id and w.owner_id = (select auth.uid())
  );
$$;

create or replace function public.ensure_creator_workspace()
returns uuid language plpgsql security definer set search_path=public as $$
declare workspace_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.creator_workspaces(owner_id)
  values (auth.uid())
  on conflict (owner_id) do update set owner_id = excluded.owner_id
  returning id into workspace_id;
  return workspace_id;
end;
$$;

grant execute on function public.ensure_creator_workspace() to authenticated;
grant execute on function public.owns_creator_workspace(uuid) to authenticated;

create or replace function public.touch_creator_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at = now(); return new; end;
$$;

do $$ declare table_name text; begin
  foreach table_name in array array['creator_workspaces','creator_folders','creator_sessions','creator_canvases','creator_assets','creator_generation_tasks']
  loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', table_name, table_name);
    execute format('create trigger %I_touch_updated_at before update on public.%I for each row execute function public.touch_creator_updated_at()', table_name, table_name);
  end loop;
end $$;

alter table public.creator_workspaces enable row level security;
alter table public.creator_folders enable row level security;
alter table public.creator_sessions enable row level security;
alter table public.creator_messages enable row level security;
alter table public.creator_canvases enable row level security;
alter table public.creator_assets enable row level security;
alter table public.creator_generation_tasks enable row level security;

create policy "creator workspace owner all" on public.creator_workspaces
  for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "creator folders owner all" on public.creator_folders
  for all using (public.owns_creator_workspace(workspace_id)) with check (public.owns_creator_workspace(workspace_id));
create policy "creator sessions owner all" on public.creator_sessions
  for all using (public.owns_creator_workspace(workspace_id)) with check (public.owns_creator_workspace(workspace_id));
create policy "creator messages owner all" on public.creator_messages
  for all using (exists (select 1 from public.creator_sessions s where s.id = session_id and public.owns_creator_workspace(s.workspace_id)))
  with check (exists (select 1 from public.creator_sessions s where s.id = session_id and public.owns_creator_workspace(s.workspace_id)));
create policy "creator canvases owner all" on public.creator_canvases
  for all using (public.owns_creator_workspace(workspace_id)) with check (public.owns_creator_workspace(workspace_id));
create policy "creator assets owner all" on public.creator_assets
  for all using (public.owns_creator_workspace(workspace_id)) with check (public.owns_creator_workspace(workspace_id));
create policy "creator tasks owner all" on public.creator_generation_tasks
  for all using (user_id = (select auth.uid()) and public.owns_creator_workspace(workspace_id))
  with check (user_id = (select auth.uid()) and public.owns_creator_workspace(workspace_id));

insert into storage.buckets (id, name, public)
values ('creator-assets', 'creator-assets', false)
on conflict (id) do update set public = false;

create policy "creator assets storage read" on storage.objects for select to authenticated
  using (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "creator assets storage insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "creator assets storage update" on storage.objects for update to authenticated
  using (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "creator assets storage delete" on storage.objects for delete to authenticated
  using (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

- [ ] **Step 4: Run the schema contract test**

Run: `npx tsx --test tests/creator/foundation-schema.test.ts`  
Expected: 2 tests PASS.

- [ ] **Step 5: Commit and push the isolated schema**

```bash
git add tests/creator/foundation-schema.test.ts supabase/migrations/0003_creator_foundation.sql
git commit -m "feat(creator): add private workspace schema"
git push origin main
```

### Task 2: Trusted usage ledger schema and cost calculator

**Files:**
- Create: `supabase/migrations/0004_ai_usage_ledger.sql`
- Modify: `tests/creator/foundation-schema.test.ts`
- Create: `lib/usage/types.ts`
- Create: `lib/usage/cost.ts`
- Create: `tests/usage/cost.test.ts`

**Interfaces:**
- Consumes: `creator_workspaces`, `creator_generation_tasks`, existing `projects`, `profiles`.
- Produces: `UsagePriceSnapshot`; `UsageMeasurements`; `calculateEstimatedCost(measurements, snapshot): string`; `ai_usage_ledger`.

- [ ] **Step 1: Extend the schema test and add failing cost tests**

Add to `tests/creator/foundation-schema.test.ts`:

```ts
test('usage ledger migration stores exact money and price snapshots', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/0004_ai_usage_ledger.sql'), 'utf8');
  assert.match(sql, /create table if not exists public\.ai_usage_ledger/);
  assert.match(sql, /reported_cost_usd numeric\(20,10\)/);
  assert.match(sql, /estimated_cost_usd numeric\(20,10\)/);
  assert.match(sql, /price_snapshot jsonb not null/);
  assert.match(sql, /check \(cost_source in \('reported','estimated','unknown'\)\)/);
});
```

Create `tests/usage/cost.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateEstimatedCost } from '../../lib/usage/cost';

test('calculates text cost from input and output tokens', () => {
  assert.equal(calculateEstimatedCost(
    { inputTokens: 1_000_000, outputTokens: 500_000 },
    { currency: 'USD', inputTokenUsdPerMillion: '2', outputTokenUsdPerMillion: '8' },
  ), '6.0000000000');
});

test('adds fixed image and video unit prices without binary float drift', () => {
  assert.equal(calculateEstimatedCost(
    { imageCount: 2, videoSeconds: 5 },
    { currency: 'USD', imageUsdEach: '0.125', videoUsdPerSecond: '0.08' },
  ), '0.6500000000');
});

test('returns zero when no priced measurement is present', () => {
  assert.equal(calculateEstimatedCost({}, { currency: 'USD' }), '0.0000000000');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx tsx --test tests/creator/foundation-schema.test.ts tests/usage/cost.test.ts`  
Expected: FAIL because the ledger migration and usage modules do not exist.

- [ ] **Step 3: Create the ledger migration**

```sql
create table if not exists public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid references public.creator_workspaces(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  creator_task_id uuid references public.creator_generation_tasks(id) on delete set null,
  request_id text not null unique,
  provider_request_id text,
  kind text not null check (kind in ('text','image','video')),
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  input_units numeric(20,10) not null default 0,
  output_units numeric(20,10) not null default 0,
  image_count integer not null default 0,
  video_seconds numeric(12,3) not null default 0,
  resolution text,
  generate_audio boolean,
  reported_cost_usd numeric(20,10),
  estimated_cost_usd numeric(20,10),
  currency text not null default 'USD',
  cost_source text not null default 'unknown' check (cost_source in ('reported','estimated','unknown')),
  price_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'succeeded' check (status in ('submitted','succeeded','failed','unknown')),
  possibly_charged boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_usage_ledger_user_created_idx
  on public.ai_usage_ledger(user_id, created_at desc);
create index if not exists ai_usage_ledger_model_created_idx
  on public.ai_usage_ledger(model, created_at desc);

alter table public.ai_usage_ledger enable row level security;

create policy "usage ledger self read" on public.ai_usage_ledger
  for select using (user_id = (select auth.uid()));
create policy "usage ledger admin read" on public.ai_usage_ledger
  for select using (public.is_admin());

revoke insert, update, delete on public.ai_usage_ledger from anon, authenticated;
```

- [ ] **Step 4: Implement exact decimal cost calculation**

Create `lib/usage/types.ts`:

```ts
export type CostSource = 'reported' | 'estimated' | 'unknown';

export type UsageMeasurements = {
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  videoSeconds?: number;
};

export type UsagePriceSnapshot = {
  currency: 'USD';
  inputTokenUsdPerMillion?: string;
  outputTokenUsdPerMillion?: string;
  imageUsdEach?: string;
  videoUsdPerSecond?: string;
  capturedAt?: string;
};
```

Create `lib/usage/cost.ts` with fixed 10-decimal integer arithmetic:

```ts
import type { UsageMeasurements, UsagePriceSnapshot } from './types';

const SCALE = 10_000_000_000n;
const MILLION = 1_000_000n;

function decimal(value?: string): bigint {
  if (!value) return 0n;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt((fraction + '0000000000').slice(0, 10));
}

function format(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / SCALE}.${(abs % SCALE).toString().padStart(10, '0')}`;
}

export function calculateEstimatedCost(m: UsageMeasurements, p: UsagePriceSnapshot): string {
  let scaled = 0n;
  scaled += BigInt(m.inputTokens || 0) * decimal(p.inputTokenUsdPerMillion) / MILLION;
  scaled += BigInt(m.outputTokens || 0) * decimal(p.outputTokenUsdPerMillion) / MILLION;
  scaled += BigInt(m.imageCount || 0) * decimal(p.imageUsdEach);
  scaled += BigInt(Math.round((m.videoSeconds || 0) * 1000)) * decimal(p.videoUsdPerSecond) / 1000n;
  return format(scaled);
}
```

- [ ] **Step 5: Run focused tests**

Run: `npx tsx --test tests/creator/foundation-schema.test.ts tests/usage/cost.test.ts`  
Expected: 5 tests PASS.

- [ ] **Step 6: Commit and push ledger foundations**

```bash
git add supabase/migrations/0004_ai_usage_ledger.sql tests/creator/foundation-schema.test.ts lib/usage/types.ts lib/usage/cost.ts tests/usage/cost.test.ts
git commit -m "feat(usage): add trusted cost ledger foundation"
git push origin main
```

### Task 3: Server-only ledger writer

**Files:**
- Create: `lib/supabase/admin.ts`
- Create: `lib/usage/ledger.ts`
- Create: `tests/usage/ledger.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, Supabase `from('ai_usage_ledger').upsert()`.
- Produces: `createAdminClient()`; `buildTextLedgerEntry(input)`; `recordUsageBestEffort(entry, dependencies?)`.

- [ ] **Step 1: Write failing mapper and persistence tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTextLedgerEntry, recordUsageBestEffort } from '../../lib/usage/ledger';

test('maps text model usage into an unknown-cost ledger entry', () => {
  const row = buildTextLedgerEntry({
    requestId: 'req-1', userId: 'user-1', projectId: null,
    provider: 'wetoken', model: 'gpt-5.6-luna',
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  });
  assert.deepEqual(row, {
    request_id: 'req-1', user_id: 'user-1', workspace_id: null, project_id: null,
    creator_task_id: null, kind: 'text', provider: 'wetoken', model: 'gpt-5.6-luna',
    input_tokens: 12, output_tokens: 8, total_tokens: 20,
    cost_source: 'unknown', price_snapshot: {}, status: 'succeeded', possibly_charged: true,
  });
});

test('best-effort ledger persistence never hides a successful model response', async () => {
  await assert.doesNotReject(recordUsageBestEffort({ request_id: 'req-1' } as never, {
    upsert: async () => { throw new Error('database unavailable'); },
  }));
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx tsx --test tests/usage/ledger.test.ts`  
Expected: FAIL because `lib/usage/ledger.ts` does not exist.

- [ ] **Step 3: Add the server-only Supabase admin client**

```ts
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service role environment is incomplete');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
```

Add to `.env.example` beneath the public Supabase keys:

```dotenv
# 仅服务端：后台可信计费写入，绝不能加 NEXT_PUBLIC_ 前缀
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...你的_service_role_key
```

- [ ] **Step 4: Implement the ledger mapper and best-effort writer**

```ts
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

type TextUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

export function buildTextLedgerEntry(input: {
  requestId?: string; userId: string; workspaceId?: string | null; projectId?: string | null;
  provider: string; model: string; usage: TextUsage;
}) {
  return {
    request_id: input.requestId || randomUUID(), user_id: input.userId,
    workspace_id: input.workspaceId ?? null, project_id: input.projectId ?? null,
    creator_task_id: null, kind: 'text', provider: input.provider, model: input.model,
    input_tokens: input.usage?.prompt_tokens ?? 0,
    output_tokens: input.usage?.completion_tokens ?? 0,
    total_tokens: input.usage?.total_tokens ?? 0,
    cost_source: 'unknown', price_snapshot: {}, status: 'succeeded', possibly_charged: true,
  } as const;
}

export async function recordUsageBestEffort(
  row: ReturnType<typeof buildTextLedgerEntry>,
  dependency?: { upsert(row: ReturnType<typeof buildTextLedgerEntry>): Promise<unknown> },
) {
  try {
    if (dependency) await dependency.upsert(row);
    else await createAdminClient().from('ai_usage_ledger').upsert(row, { onConflict: 'request_id' });
  } catch {
    // Accounting failure must not replace a successful provider response.
  }
}
```

- [ ] **Step 5: Run focused tests**

Run: `npx tsx --test tests/usage/ledger.test.ts`  
Expected: 2 tests PASS.

- [ ] **Step 6: Commit and push the trusted writer**

```bash
git add .env.example lib/supabase/admin.ts lib/usage/ledger.ts tests/usage/ledger.test.ts
git commit -m "feat(usage): add server-only ledger writer"
git push origin main
```

### Task 4: Workspace domain types and bootstrap API

**Files:**
- Create: `lib/creator/types.ts`
- Create: `lib/creator/workspace.ts`
- Create: `tests/creator/workspace.test.ts`
- Create: `app/api/creator/workspace/route.ts`

**Interfaces:**
- Consumes: authenticated Supabase client with `rpc('ensure_creator_workspace')` and `from('creator_workspaces')`.
- Produces: `ensureCreatorWorkspace(client, userId): Promise<CreatorWorkspace>`; `GET/POST /api/creator/workspace` returning `{ workspace }`.

- [ ] **Step 1: Write the failing workspace helper tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCreatorWorkspace } from '../../lib/creator/workspace';

test('ensures then loads the authenticated user workspace', async () => {
  const calls: string[] = [];
  const workspace = { id: 'w1', owner_id: 'u1', name: '我的创作空间', settings: {}, created_at: 'now', updated_at: 'now' };
  const client = {
    rpc: async () => { calls.push('rpc'); return { data: 'w1', error: null }; },
    load: async (id: string) => { calls.push(`load:${id}`); return { data: workspace, error: null }; },
  };
  assert.deepEqual(await ensureCreatorWorkspace(client, 'u1'), workspace);
  assert.deepEqual(calls, ['rpc', 'load:w1']);
});

test('rejects a workspace owned by another user', async () => {
  const client = {
    rpc: async () => ({ data: 'w2', error: null }),
    load: async () => ({ data: { id: 'w2', owner_id: 'u2' }, error: null }),
  };
  await assert.rejects(() => ensureCreatorWorkspace(client, 'u1'), /workspace ownership mismatch/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx tsx --test tests/creator/workspace.test.ts`  
Expected: FAIL because workspace modules do not exist.

- [ ] **Step 3: Add creator domain types**

```ts
export const CREATOR_TASK_STATUSES = ['draft','submitting','queued','running','succeeded','failed','expired','unknown'] as const;
export type CreatorTaskStatus = typeof CREATOR_TASK_STATUSES[number];
export type CreatorKind = 'chat' | 'image' | 'video';

export type CreatorWorkspace = {
  id: string; owner_id: string; name: string; settings: Record<string, unknown>;
  created_at: string; updated_at: string;
};
```

- [ ] **Step 4: Implement the dependency-injected helper**

```ts
import type { CreatorWorkspace } from './types';

type WorkspaceClient = {
  rpc(): Promise<{ data: string | null; error: { message: string } | null }>;
  load(id: string): Promise<{ data: CreatorWorkspace | null; error: { message: string } | null }>;
};

export async function ensureCreatorWorkspace(client: WorkspaceClient, userId: string): Promise<CreatorWorkspace> {
  const ensured = await client.rpc();
  if (ensured.error || !ensured.data) throw new Error(ensured.error?.message || 'workspace bootstrap failed');
  const loaded = await client.load(ensured.data);
  if (loaded.error || !loaded.data) throw new Error(loaded.error?.message || 'workspace load failed');
  if (loaded.data.owner_id !== userId) throw new Error('workspace ownership mismatch');
  return loaded.data;
}
```

- [ ] **Step 5: Add the authenticated Route Handler adapter**

```ts
import { NextResponse } from 'next/server';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

async function handle() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  try {
    const workspace = await ensureCreatorWorkspace({
      rpc: async () => supabase.rpc('ensure_creator_workspace'),
      load: async (id) => supabase.from('creator_workspaces').select('*').eq('id', id).single(),
    }, user.id);
    return NextResponse.json({ workspace });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '私人空间初始化失败' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
```

- [ ] **Step 6: Run the focused tests**

Run: `npx tsx --test tests/creator/workspace.test.ts`  
Expected: 2 tests PASS.

- [ ] **Step 7: Commit and push the bootstrap API**

```bash
git add lib/creator/types.ts lib/creator/workspace.ts tests/creator/workspace.test.ts app/api/creator/workspace/route.ts
git commit -m "feat(creator): add private workspace bootstrap API"
git push origin main
```

### Task 5: Dual-write current text usage without changing responses

**Files:**
- Modify: `app/api/ai/chat/route.ts`
- Modify: `tests/usage/ledger.test.ts`

**Interfaces:**
- Consumes: `resolveTextModel` result provider, `buildTextLedgerEntry`, `recordUsageBestEffort`.
- Produces: existing `{ content, usage }` response unchanged; trusted `ai_usage_ledger` row keyed by one request UUID.

- [ ] **Step 1: Add a regression assertion for provider mapping**

Extend `tests/usage/ledger.test.ts`:

```ts
test('DeepSeek text usage keeps its provider identity', () => {
  const row = buildTextLedgerEntry({
    requestId: 'req-deepseek', userId: 'u1', provider: 'deepseek', model: 'deepseek-flash',
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  });
  assert.equal(row.provider, 'deepseek');
  assert.equal(row.total_tokens, 3);
});
```

- [ ] **Step 2: Run the focused test**

Run: `npx tsx --test tests/usage/ledger.test.ts`  
Expected: PASS; this locks the mapper before route wiring.

- [ ] **Step 3: Wire best-effort trusted accounting into the existing route**

Add imports:

```ts
import { randomUUID } from 'node:crypto';
import { buildTextLedgerEntry, recordUsageBestEffort } from '@/lib/usage/ledger';
```

Immediately after `chatWithTextModel` succeeds, create one request ID and keep the existing `ai_usage` insert. Then add:

```ts
await recordUsageBestEffort(buildTextLedgerEntry({
  requestId: randomUUID(),
  userId: user.id,
  projectId: body.projectId ?? null,
  provider: spec.provider,
  model: spec.id,
  usage: result.usage,
}));
```

Do not change request validation, model invocation, HTTP status codes, or the final response:

```ts
return NextResponse.json({ content: result.content, usage: result.usage });
```

- [ ] **Step 4: Run AI and usage tests**

Run: `npx tsx --test tests/ai/*.test.ts tests/usage/*.test.ts`  
Expected: all AI and usage tests PASS.

- [ ] **Step 5: Commit and push the additive accounting hook**

```bash
git add app/api/ai/chat/route.ts tests/usage/ledger.test.ts
git commit -m "feat(usage): record trusted text usage"
git push origin main
```

### Task 6: Foundation verification and handoff

**Files:**
- Modify only if verification exposes a defect in files from Tasks 1–5.

**Interfaces:**
- Consumes: all foundation migrations, modules, tests, and API route.
- Produces: a clean buildable commit on `origin/main`, ready for Supabase migration application and the chat workspace plan.

- [ ] **Step 1: Scan migrations for secrets and destructive changes**

Run: `rg -n "sk-|SERVICE_ROLE_KEY=eyJ[^.]*\.[^.]*\.[A-Za-z0-9_-]+|drop table|alter table public\.projects|alter table public\.project_members" supabase lib app tests .env.example`  
Expected: no real key and no destructive/project-table match; `.env.example` contains only a placeholder.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`  
Expected: all tests PASS.

- [ ] **Step 3: Run the production build**

Run: `npm run build`  
Expected: Next.js production build exits 0 and lists `/api/creator/workspace`.

- [ ] **Step 4: Check the final diff and working tree**

Run: `git diff --check`  
Expected: no whitespace errors.

Run: `git status --short`  
Expected: clean, or only explicitly identified unrelated user files.

- [ ] **Step 5: Confirm remote state**

Run: `git log -6 --oneline`  
Expected: the foundation commits appear above `docs: define private AI creator workspace`.

Run: `git status -sb`  
Expected: `main` is aligned with `origin/main`.

---

## Self-Review Results

- Spec coverage: private workspace isolation, project compatibility, RLS, private Storage, generation task lifecycle, trusted per-user usage, cost-source distinction, price snapshots, and additive text accounting all have explicit tasks.
- Deferred by scope: sessions/messages CRUD, chat UI, media draft/confirm endpoints, image/video generation UI, send-to-project, and admin dashboards belong to the four subsequent sub-project plans.
- Placeholder scan: no TBD/TODO/“similar to” implementation gaps remain.
- Type consistency: `CreatorWorkspace`, task statuses, `UsagePriceSnapshot`, ledger field names, and workspace RPC names match across migrations, modules, tests, and route adapters.
