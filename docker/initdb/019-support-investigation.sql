BEGIN;
ALTER TABLE support_bot_jobs ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE support_bot_jobs ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'queued';
COMMIT;
