BEGIN;

CREATE INDEX IF NOT EXISTS support_bot_group_topic_conversation
ON support_bot_tickets(chat_id,thread_id,updated_at DESC)
WHERE status='open';

COMMIT;
