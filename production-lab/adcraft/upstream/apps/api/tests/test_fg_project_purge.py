import importlib.util
import pathlib
import sqlite3
import tempfile
import os
import unittest
from unittest.mock import patch
from contextlib import closing

spec=importlib.util.spec_from_file_location('fg_backup',pathlib.Path(__file__).parents[1]/'app/fg_backup.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class FGPurgeTest(unittest.TestCase):
 def test_fk_owned_workflow_removed_other_project_and_library_retained(self):
  with tempfile.TemporaryDirectory(dir=os.environ.get('FG_TEST_TMPDIR')) as root:
   active=pathlib.Path(root)/'active.sqlite3';snapshot=pathlib.Path(root)/'snapshot.sqlite3'
   with closing(sqlite3.connect(active)) as db:
    db.executescript("CREATE TABLE projects(project_id TEXT PRIMARY KEY,status TEXT);CREATE TABLE flows(workflow_id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(project_id));CREATE TABLE nodes(node_id TEXT PRIMARY KEY,workflow_id TEXT REFERENCES flows(workflow_id));CREATE TABLE assets(asset_id TEXT PRIMARY KEY,source_workflow_id TEXT);INSERT INTO projects VALUES('proj_old','trashed'),('proj_keep','active');INSERT INTO flows VALUES('f1','proj_old'),('f2','proj_keep');INSERT INTO nodes VALUES('n1','f1'),('n2','f2');INSERT INTO assets VALUES('shared','f1');")
   with patch.object(module,'require_workspace'),patch.object(module,'database_paths',return_value=(active,snapshot)),patch.object(module,'backup'):
    with self.assertRaises(RuntimeError):module.purge_trashed_project('w','proj_keep')
    module.purge_trashed_project('w','proj_old')
   with closing(sqlite3.connect(active)) as db:
    self.assertEqual(db.execute('SELECT node_id FROM nodes').fetchall(),[('n2',)])
    self.assertEqual(db.execute('SELECT asset_id FROM assets').fetchall(),[('shared',)])
    self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

if __name__=='__main__':unittest.main()
