"""Exercise the recovery guard on PostgreSQL temporary tables; no real rows change."""
import ast
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parent
tree = ast.parse((root / 'maintain-host.py').read_text())
query = next(ast.literal_eval(node.value) for node in tree.body
             if isinstance(node, ast.Assign)
             and any(isinstance(target, ast.Name) and target.id == 'ACTIVE_TASK_COUNT_SQL'
                     for target in node.targets))

cases = [
    ('terminal records', "INSERT INTO tasks VALUES ('a','succeeded',now(),now()),('b','failed',now(),now()),('c','cancelled',now(),now());", 0),
    ('abandoned replay', "INSERT INTO tasks VALUES ('a','text_replay',now()-interval '1 day',now()-interval '1 day');", 0),
    ('recent replay start', "INSERT INTO tasks VALUES ('a','text_replay',now(),NULL);", 1),
    ('recent replay update', "INSERT INTO tasks VALUES ('a','text_replay',now()-interval '1 day',now());", 1),
    ('recent streamed delta', "INSERT INTO tasks VALUES ('a','text_replay',now()-interval '1 day',now()-interval '1 day'); INSERT INTO task_text_delta VALUES ('a',now());", 1),
    ('old streamed delta', "INSERT INTO tasks VALUES ('a','text_replay',now()-interval '1 day',now()-interval '1 day'); INSERT INTO task_text_delta VALUES ('a',now()-interval '1 day');", 0),
    ('queued and running', "INSERT INTO tasks VALUES ('a','queued',now()-interval '1 day',now()-interval '1 day'),('b','running',now()-interval '1 day',now()-interval '1 day');", 2),
    ('unknown state blocks', "INSERT INTO tasks VALUES ('a','future_status',now()-interval '1 day',now()-interval '1 day');", 1),
]
parts = ["BEGIN;", "CREATE TEMP TABLE tasks (id text, status text, created_at timestamptz, updated_at timestamptz);",
         "CREATE TEMP TABLE task_text_delta (task_id text, created_at timestamptz);",
         "SET LOCAL search_path TO pg_temp;"]
for label, setup, expected in cases:
    parts.extend(["TRUNCATE tasks, task_text_delta;", setup,
                  "DO $$ BEGIN IF (" + query.strip() + ") <> " + str(expected)
                  + " THEN RAISE EXCEPTION 'Recovery guard failed: " + label + "'; END IF; END $$;"])
parts.append("ROLLBACK;")
subprocess.run(['/usr/local/bin/docker', 'exec', '-i', 'fg-six-yingce-postgres-1',
                'psql', '-U', 'fg_yingce', '-d', 'fg_yingce', '-v', 'ON_ERROR_STOP=1', '-q'],
               input='\n'.join(parts).encode(), check=True, timeout=30)
print('8 PostgreSQL recovery cases passed; real task records unchanged')
