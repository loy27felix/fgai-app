import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const migrationNames = ["002-local-upgrade.sql", "003-local-observability.sql"];
const advisoryLockId = 1894215638;
const prefix = "[fg-db-migrate]";

function log(stage, details = {}) {
  // Keep these startup logs structured and safe to ship from the NAS host:
  // migration name/checksum only; never credentials or database URLs.
  console.log(`${prefix} ${JSON.stringify({ event: "local_db_migration", stage, ...details })}`);
}

function errorDetails(error) {
  if (!(error instanceof Error)) return { message: String(error).slice(0, 500) };
  const postgres = error;
  return {
    name: postgres.name,
    code: typeof postgres.code === "string" ? postgres.code : undefined,
    message: postgres.message.slice(0, 500),
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required before starting FG Studio.");

  const client = new Client({ connectionString: databaseUrl });
  let locked = false;
  let activeMigration = null;

  try {
    await client.connect();
    log("connected", { migrations: migrationNames });
    await client.query("SELECT pg_advisory_lock($1)", [advisoryLockId]);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS fg_schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const migrationName of migrationNames) {
      activeMigration = migrationName;
      const migrationPath = new URL(`../docker/initdb/${migrationName}`, import.meta.url);
      const sql = await readFile(migrationPath, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex").toString();
      const applied = await client.query(
        "SELECT checksum FROM fg_schema_migrations WHERE name = $1",
        [migrationName],
      );
      if (applied.rowCount) {
        if (applied.rows[0]?.checksum !== checksum) {
          throw new Error(`Migration ${migrationName} changed after it was already applied; create a new migration instead.`);
        }
        log("already_applied", { migration: migrationName });
        continue;
      }

      log("applying", { migration: migrationName });
      await client.query(sql);
      await client.query(
        "INSERT INTO fg_schema_migrations (name, checksum) VALUES ($1, $2)",
        [migrationName, checksum],
      );
      log("applied", { migration: migrationName });
    }
  } catch (error) {
    console.error(`${prefix} ${JSON.stringify({ event: "local_db_migration", stage: "failed", migration: activeMigration, ...errorDetails(error) })}`);
    process.exitCode = 1;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [advisoryLockId]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

void main();
