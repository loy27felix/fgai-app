BEGIN;
ALTER TABLE support_bot_jobs ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
