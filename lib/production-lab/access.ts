import { createClient } from "@/lib/local/server";
import type { Actor } from "./domain";
import { canAccessProductionLab } from "./access-policy";

export async function labActor(): Promise<Actor | null> {
  if (process.env.PRODUCTION_LAB_ENABLED === "false") return null;
  const client = createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!canAccessProductionLab(user?.platform_role, process.env.PRODUCTION_LAB_ENABLED)) return null;
  if (!user) return null;
  const email = (user.email || "").toLowerCase();
  return { id: user.id, name: email.replace(/@.*/, ""), reviewer: true };
}
