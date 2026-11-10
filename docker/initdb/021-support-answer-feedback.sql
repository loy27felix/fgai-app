BEGIN;

ALTER TABLE support_bot_jobs
  ADD COLUMN IF NOT EXISTS feedback_rating text CHECK (feedback_rating IN ('helpful', 'unhelpful')),
  ADD COLUMN IF NOT EXISTS feedback_correction text NOT NULL DEFAULT '' CHECK (char_length(feedback_correction) <= 1000),
  ADD COLUMN IF NOT EXISTS feedback_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS support_bot_job_feedback
  ON support_bot_jobs(ticket_id, feedback_updated_at DESC)
  WHERE feedback_rating IS NOT NULL;

COMMIT;
