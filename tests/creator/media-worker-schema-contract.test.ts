import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sql = fs.readFileSync("docker/initdb/013-local-media-workers.sql", "utf8");

test("local worker schema keeps leases and ownership", () => {
  assert.match(sql, /create table if not exists creator_media_workers/i);
  assert.match(sql, /create table if not exists creator_media_processing_jobs/i);
  assert.match(sql, /lease_expires_at timestamptz/i);
  assert.match(sql, /unique \(user_id, idempotency_key\)/i);
  assert.match(sql, /source_asset_id uuid not null references creator_assets/i);
  assert.match(sql, /creator_media_processing_jobs_lease_idx/i);
});

test("worker schema stores only hashes for pairings and bearer tokens", () => {
  assert.match(sql, /code_hash text not null unique/i);
  assert.match(sql, /token_hash text not null unique/i);
  assert.match(sql, /temporary_path text not null/i);
  assert.match(sql, /expected_sha256 text/i);
});

