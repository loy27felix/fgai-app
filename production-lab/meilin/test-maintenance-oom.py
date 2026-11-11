"""Replay OOM recovery decisions without starting or stopping real services."""
import ast
import json
import pathlib
import types
import unittest
from unittest.mock import Mock

source = ast.parse((pathlib.Path(__file__).parent / 'maintain-host.py').read_text())
function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'recover_oom_backend')


class OOMRecoveryTests(unittest.TestCase):
    def replay(self, state, ready=True):
        command = Mock(return_value=types.SimpleNamespace(stdout=json.dumps([{'State': state}])))
        scope = {'json': json, 'run': command, 'DOCKER': 'docker', 'print': Mock()}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<recovery>', 'exec'), scope)
        result = scope['recover_oom_backend'](ready)
        return result, command

    def test_oom_worker_starts_without_waiting_for_its_pending_jobs(self):
        result, command = self.replay({'Running': False, 'OOMKilled': True})
        self.assertTrue(result)
        self.assertEqual(command.call_count, 2)
        self.assertEqual(command.call_args.args, ('docker', 'start', 'fg-six-yingce-backend-1'))

    def test_unavailable_storage_blocks_all_start_attempts(self):
        result, command = self.replay({'Running': False, 'OOMKilled': True}, False)
        self.assertFalse(result)
        command.assert_not_called()

    def test_manually_stopped_service_is_preserved(self):
        result, command = self.replay({'Running': False, 'OOMKilled': False})
        self.assertFalse(result)
        self.assertEqual(command.call_count, 1)

    def test_running_worker_is_never_restarted(self):
        result, command = self.replay({'Running': True, 'OOMKilled': True})
        self.assertFalse(result)
        self.assertEqual(command.call_count, 1)


if __name__ == '__main__':
    unittest.main()
