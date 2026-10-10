import os
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from app import fg_backup as store

WORKSPACE = '00000000-0000-4000-8000-000000000001'
OTHER = '00000000-0000-4000-8000-000000000002'

class AdvertisingRetentionTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        nas_root = self.root / 'nas'
        self.nas = nas_root / 'media'
        self.nas.mkdir(parents=True)
        (self.nas / '.fg-studio-nas-ready').write_text('ready')
        self.patch_nas = patch.object(store, 'NAS', self.nas)
        self.patch_nas.start()
        self.addCleanup(self.patch_nas.stop)
        patch_root = patch.object(store, 'NAS_ROOT', nas_root)
        patch_root.start()
        self.addCleanup(patch_root.stop)
        self.patch_env = patch.dict(os.environ, {'FG_ADCRAFT_SQLITE_ROOT': str(self.root / 'server')})
        self.patch_env.start()
        self.addCleanup(self.patch_env.stop)
        self.media = self.nas / 'adcraft/workspaces' / WORKSPACE
        self.media.mkdir(parents=True)
        (self.media / 'video.mp4').write_bytes(b'test-video')
        self.other = self.nas / 'adcraft/workspaces' / OTHER
        self.other.mkdir()
        (self.other / 'keep.png').write_bytes(b'shared-project')

    def test_cleanup_is_idempotent_and_does_not_remove_neighbour_or_regrow_snapshot(self):
        active, snapshot = store.database_paths(WORKSPACE)
        active.parent.mkdir(parents=True)
        with closing(sqlite3.connect(active)) as db, db:
            db.execute('CREATE TABLE agent_runs(status TEXT)')
            db.execute("INSERT INTO agent_runs VALUES('succeeded')")
        store.backup(WORKSPACE)
        self.assertTrue(snapshot.exists())
        self.assertTrue(store.purge_workspace(WORKSPACE)['purged'])
        self.assertFalse(self.media.exists())
        recovered = self.root / 'nas/recycle/adcraft' / WORKSPACE
        self.assertEqual((recovered / 'video.mp4').read_bytes(), b'test-video')
        self.assertTrue((recovered / 'database-backup/adcraft.sqlite3').is_file())
        self.assertTrue((self.other / 'keep.png').is_file())
        self.assertTrue(active.is_file())
        store.backup(WORKSPACE)
        self.assertFalse(snapshot.exists())
        self.assertTrue(store.purge_workspace(WORKSPACE)['purged'])
        with self.assertRaises(RuntimeError): store.restore(WORKSPACE)

    def test_no_cleanup_while_nas_offline_or_task_running(self):
        (self.nas / '.fg-studio-nas-ready').unlink()
        with self.assertRaises(RuntimeError): store.purge_workspace(WORKSPACE)
        self.assertTrue(self.media.exists())
        (self.nas / '.fg-studio-nas-ready').write_text('ready')
        active, _ = store.database_paths(WORKSPACE)
        active.parent.mkdir(parents=True)
        with closing(sqlite3.connect(active)) as db, db:
            db.execute('CREATE TABLE agent_runs(status TEXT)')
            db.execute("INSERT INTO agent_runs VALUES('running')")
        with self.assertRaises(RuntimeError): store.purge_workspace(WORKSPACE)
        self.assertTrue(self.media.exists())
        self.assertFalse(store.purge_marker(WORKSPACE).exists())

    def test_directory_traversal_cannot_delete_another_workspace(self):
        with self.assertRaises(ValueError): store.purge_workspace('../' + OTHER)
        self.assertTrue(self.media.exists())
        self.assertTrue(self.other.exists())

    def test_recycle_collision_preserves_both_directories(self):
        recycled = self.root / 'nas/recycle/adcraft' / WORKSPACE
        recycled.mkdir(parents=True)
        (recycled / 'keep.mp4').write_bytes(b'earlier-recycle')
        with self.assertRaises(RuntimeError): store.purge_workspace(WORKSPACE)
        self.assertEqual((self.media / 'video.mp4').read_bytes(), b'test-video')
        self.assertEqual((recycled / 'keep.mp4').read_bytes(), b'earlier-recycle')
        self.assertFalse(store.purge_marker(WORKSPACE).exists())

if __name__ == '__main__': unittest.main()
