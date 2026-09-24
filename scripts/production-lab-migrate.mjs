import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const migrationNames = ["005-media-queue-and-assets.sql", "006-superadmin-groups-and-accounting.sql"];
const targetUrl = process.env.PRODUCTION_LAB_DATABASE_URL;
const primaryUrl = process.env.DATABASE_URL;
const prefix = "[fg-production-lab-migrate]";

function identity(value) {
  const url = new URL(value);
  return `${url.hostname.toLowerCase()}:${url.port || "5432"}${decodeURIComponent(url.pathname)}`;
}

function log(stage, details = {}) {
  console.log(`${prefix} ${JSON.stringify({ event: "production_lab_migration", stage, ...details })}`);
}

async function main() {
  if (!targetUrl) throw new Error("PRODUCTION_LAB_DATABASE_URL is required; DATABASE_URL is never a migration target.");
  if (!primaryUrl) throw new Error("DATABASE_URL must be set so the isolated database guard can compare targets.");
  if (identity(targetUrl) === identity(primaryUrl)) throw new Error("Refusing to migrate the primary database: it matches DATABASE_URL.");

  const client = new Client({ connectionString: targetUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const check = await client.query(`
      SELECT current_database() AS database_name, current_user AS database_user,
        to_regclass('production_lab_state') IS NOT NULL AS has_lab_state,
        to_regclass('production_lab_canvas_graphs') IS NOT NULL AS has_lab_canvas
    `);
    const target = check.rows[0];
    if (!target?.has_lab_state || !target?.has_lab_canvas) {
      throw new Error("Target is missing the existing Production Lab tables; migration refused. Verify PRODUCTION_LAB_DATABASE_URL points to the isolated fg_production_lab database.");
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS production_lab_schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const migrationName of migrationNames) {
      const migrationSql = await readFile(new URL(`../production-lab/migrations/${migrationName}`, import.meta.url), "utf8");
      const checksum = createHash("sha256").update(migrationSql).digest("hex");
      const existing = await client.query("SELECT checksum FROM production_lab_schema_migrations WHERE name=$1", [migrationName]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`${migrationName} was previously applied with a different checksum.`);
        log("already_applied", { migration: migrationName, database: target.database_name });
        continue;
      }

      log("applying", { migration: migrationName, database: target.database_name, databaseUser: target.database_user });
      await client.query(migrationSql);
      await client.query("INSERT INTO production_lab_schema_migrations(name,checksum) VALUES($1,$2)", [migrationName, checksum]);
      log("applied", { migration: migrationName, database: target.database_name });
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${prefix} ${JSON.stringify({ event: "production_lab_migration", stage: "failed", message: message.slice(0, 500) })}`);
  process.exitCode = 1;
});
