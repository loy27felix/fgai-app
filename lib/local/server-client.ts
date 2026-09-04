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
        // Resolve the unique owner row atomically so concurrent requests do not
        // race between SELECT and INSERT and turn normal page fan-out into 500s.
        // 通过唯一键原子 upsert，避免并发页面请求在 SELECT/INSERT 之间竞争而返回 500。
        const ensured = await new LocalQuery<{ id: string }>("creator_workspaces")
          .upsert({ owner_id: user.id }, { onConflict: "owner_id" })
          .select("id")
          .single();
        return { data: (ensured.data as { id: string } | null)?.id || null, error: ensured.error };
      }
      return { data: null, error: { message: `Unsupported local RPC: ${name}` } };
    },
    storage: { from: (bucket: string) => localStorage(bucket) },
    currentUser: userPromise,
    cookies,
  };
}
