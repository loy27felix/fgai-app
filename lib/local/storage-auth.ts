import { query } from "@/lib/local/db";

export async function canAccessStoragePath(userId: string, bucket: string, name: string) {
  const owner = name.split("/", 1)[0];
  if (!owner) return false;
  if (bucket === "creator-assets") return owner === userId;
  if (bucket !== "project-assets") return false;
  if (!/^[0-9a-f-]{36}$/i.test(owner)) return false;
  const membership = await query(
    "select 1 from project_members where project_id = $1 and user_id = $2 limit 1",
    [owner, userId],
  );
  return Boolean(membership.rowCount);
}
