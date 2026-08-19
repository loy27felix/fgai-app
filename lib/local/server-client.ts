import { cookies } from "next/headers";
import { getCurrentUser, clearSession } from "@/lib/local/auth";
import { LocalQuery } from "@/lib/local/db";
import { localStorage } from "@/lib/local/storage";

export function createClient(options?: { bypassAuth?: boolean }) {
  const userPromise = options?.bypassAuth ? Promise.resolve(null) : getCurrentUser();
  return {
    auth: {
      getUser: async () => ({ data: { user: await userPromise }, error: null }),
      getSession: async () => ({ data: { session: (await userPromise) ? { user: await userPromise } : null }, error: null }),
      signOut: async () => { await clearSession(); return { error: null }; },
    },
    from: (table: string) => new LocalQuery<any>(table),
    rpc: async (name: string) => {
      if (name === "ensure_creator_workspace") {
        const user = await userPromise;
        if (!user) return { data: null, error: { message: "未登录" } };
        const existing = await new LocalQuery<{ id: string }>("creator_workspaces").select("id").eq("owner_id", user.id).maybeSingle();
        if (existing.data) return { data: (existing.data as { id: string }).id, error: null };
        const inserted = await new LocalQuery<{ id: string }>("creator_workspaces").insert({ owner_id: user.id }).select("id").single();
        return { data: (inserted.data as { id: string } | null)?.id || null, error: inserted.error };
      }
      return { data: null, error: { message: `Unsupported local RPC: ${name}` } };
    },
    storage: { from: (bucket: string) => localStorage(bucket) },
    currentUser: userPromise,
    cookies,
  };
}
