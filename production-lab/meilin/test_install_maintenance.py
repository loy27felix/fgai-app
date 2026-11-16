import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('install_maintenance', pathlib.Path(__file__).with_name('install-maintenance.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class MaintenanceInstallerTest(unittest.TestCase):
    def setUp(self):
        uid = patch.object(installer.os, 'getuid', return_value=501, create=True)
        uid.start()
        self.addCleanup(uid.stop)

    def test_loaded_job_is_untouched(self):
        with patch.object(installer.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as run, patch.object(installer.pathlib.Path, 'write_bytes') as write:
            installer.main()
            self.assertEqual(run.call_count, 1)
            write.assert_not_called()

    def test_explicitly_disabled_job_is_untouched(self):
        replies = [subprocess.CompletedProcess([], 113, '', 'Could not find service'), subprocess.CompletedProcess([], 0, '"com.fgstudio.six.yingce" => disabled', '')]
        with patch.object(installer.subprocess, 'run', side_effect=replies) as run, patch.object(installer.pathlib.Path, 'write_bytes') as write:
            with self.assertRaisesRegex(RuntimeError, 'explicitly disabled'):
                installer.main()
            self.assertEqual(run.call_count, 2)
            write.assert_not_called()

    def test_unknown_job_state_fails_closed(self):
        with patch.object(installer.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'permission denied')) as run:
            with self.assertRaisesRegex(RuntimeError, 'determine'):
                installer.main()
            self.assertEqual(run.call_count, 1)

    def test_missing_enabled_job_registers_without_stop(self):
        replies = [subprocess.CompletedProcess([], 113, '', 'Could not find service'), subprocess.CompletedProcess([], 0, '', ''), subprocess.CompletedProcess([], 0, '', ''), subprocess.CompletedProcess([], 0, '', '')]
        with tempfile.TemporaryDirectory() as folder, patch.object(installer.pathlib.Path, 'home', return_value=pathlib.Path(folder)), patch.object(installer.subprocess, 'run', side_effect=replies) as run:
            installer.main()
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual([command[1] for command in commands], ['print', 'print-disabled', '-lint', 'bootstrap'])
            self.assertTrue((pathlib.Path(folder) / 'Library/LaunchAgents/com.fgstudio.six.yingce.plist').is_file())


if __name__ == '__main__':
    unittest.main()
