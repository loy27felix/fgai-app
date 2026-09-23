-- Apply only to PRODUCTION_LAB_DATABASE_URL, never the original production DB.
CREATE TABLE IF NOT EXISTS production_lab_canvas_graphs (
  project_id text NOT NULL,
  episode integer NOT NULL CHECK (episode BETWEEN 1 AND 200),
  document jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, episode)
);

CREATE INDEX IF NOT EXISTS production_lab_canvas_graphs_updated
ON production_lab_canvas_graphs(updated_at DESC);
