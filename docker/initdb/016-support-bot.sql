BEGIN;

CREATE TABLE IF NOT EXISTS support_bot_tickets (id text PRIMARY KEY, open_id text NOT NULL, chat_id text NOT NULL, thread_id text NOT NULL, user_id text, status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS support_bot_ticket_conversation ON support_bot_tickets(open_id,chat_id,thread_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS support_bot_jobs (id text PRIMARY KEY, event_id text NOT NULL UNIQUE, message_id text NOT NULL UNIQUE, ticket_id text NOT NULL REFERENCES support_bot_tickets(id), text text NOT NULL, is_group boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'pending', attempts int NOT NULL DEFAULT 0, lease_token text, lease_until timestamptz, available_at timestamptz NOT NULL DEFAULT now(), diagnosis jsonb, error text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS support_bot_job_queue ON support_bot_jobs(status,available_at);
CREATE TABLE IF NOT EXISTS support_bot_delivery (job_id text NOT NULL REFERENCES support_bot_jobs(id), step text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,step));

CREATE INDEX IF NOT EXISTS support_bot_job_ticket_order ON support_bot_jobs(ticket_id,created_at,id);

COMMIT;
