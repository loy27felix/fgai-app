CREATE TABLE IF NOT EXISTS fg_meilin_dramas (
 id uuid PRIMARY KEY, owner_id varchar(36) NOT NULL REFERENCES users(id),
 document jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS fg_meilin_owner ON fg_meilin_dramas(owner_id,updated_at);
CREATE TABLE IF NOT EXISTS fg_meilin_members (
 drama_id uuid NOT NULL REFERENCES fg_meilin_dramas(id),user_id varchar(36) NOT NULL REFERENCES users(id),
 role varchar(10) NOT NULL CHECK(role IN ('viewer','editor')),PRIMARY KEY(drama_id,user_id)
);
CREATE TABLE IF NOT EXISTS fg_meilin_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,drama_id uuid NOT NULL REFERENCES fg_meilin_dramas(id),
 actor_id varchar(36) NOT NULL,action varchar(40) NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fg_meilin_support_http (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id varchar(36) NOT NULL,created_at timestamptz NOT NULL,entry jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS fg_meilin_support_http_actor_time ON fg_meilin_support_http(actor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS fg_meilin_support_http_time ON fg_meilin_support_http(created_at);
