import { Pool } from "pg";
import { EMPTY_STATE, applyCommand, type Actor, type Command, type LabState } from "./domain";

let pool: Pool | undefined;
export function database() {
  const url = process.env.PRODUCTION_LAB_DATABASE_URL;
  const identity = (value: string) => { const u = new URL(value); return `${u.hostname.toLowerCase()}:${u.port || "5432"}${decodeURIComponent(u.pathname)}`; };
  if (!url || (process.env.DATABASE_URL && identity(url) === identity(process.env.DATABASE_URL))) throw new Error("请配置独立的 PRODUCTION_LAB_DATABASE_URL；禁止使用生产数据库");
  if (!pool) pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 3000 });
  return pool;
}
export async function readLab(): Promise<LabState> {
  const result = await database().query("SELECT document FROM production_lab_state WHERE id = 'pilot'");
  return result.rows[0]?.document || structuredClone(EMPTY_STATE);
}
export async function changeLab(command: Command, actor: Actor, revision: number) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO production_lab_state(id, document) VALUES ('pilot', $1::jsonb) ON CONFLICT DO NOTHING", [JSON.stringify(EMPTY_STATE)]);
    const result = await client.query("SELECT document FROM production_lab_state WHERE id = 'pilot' FOR UPDATE");
    const current: LabState = result.rows[0].document;
    if (current.revision !== revision) throw new Error("其他同事已更新，请刷新后重试，避免覆盖修改");
    const next = applyCommand(current, command, actor);
    await client.query("UPDATE production_lab_state SET document = $1::jsonb, updated_at = now() WHERE id = 'pilot'", [JSON.stringify(next)]);
    await client.query("COMMIT"); return next;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
