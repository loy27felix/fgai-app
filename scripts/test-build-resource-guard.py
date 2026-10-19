"""Test fail-closed build admission with a fake Docker CLI, never live services."""
import os
import pathlib
import subprocess
import tempfile
import unittest

GUARD = pathlib.Path(__file__).with_name('build-resource-guard.sh')


class BuildGuardTests(unittest.TestCase):
    def replay(self, **settings):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            mock = root / 'docker'
            mock.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$FG_TEST_LOG"
case "$1 $2" in
 'buildx inspect')
  if [ "$3" = '--bootstrap' ]; then exit "${FAIL_BOOTSTRAP:-0}"; fi
  [ "${MISSING_BUILDER:-0}" = 0 ]; exit $?;;
 'buildx create') exit "${FAIL_CREATE:-0}";;
 'inspect --format') printf '%s %s\\n' "$TEST_MEMORY" "$TEST_SWAP";;
 *) exit 99;;
esac
''')
            mock.chmod(0o755)
            env = {**os.environ, 'PATH': str(root) + ':/usr/bin:/bin', 'PROJECT_ROOT': str(root),
                   'FG_BUILD_BUILDER': 'fg-test-limited', 'FG_TEST_LOG': str(root / 'calls'),
                   'TEST_MEMORY': '3221225472', 'TEST_SWAP': '3221225472', **settings}
            result = subprocess.run(['/bin/bash', '-c', 'source "$1"; ensure_build_resource_limit', 'guard-test', str(GUARD)], env=env, capture_output=True)
            calls = (root / 'calls').read_text() if (root / 'calls').exists() else ''
            return result.returncode, calls

    def test_bounded_builder_is_admitted(self):
        self.assertEqual(self.replay()[0], 0)

    def test_unbounded_memory_is_rejected(self):
        self.assertNotEqual(self.replay(TEST_MEMORY='0')[0], 0)

    def test_unbounded_swap_is_rejected(self):
        self.assertNotEqual(self.replay(TEST_SWAP='0')[0], 0)

    def test_missing_builder_creation_failure_does_not_fall_back(self):
        status, calls = self.replay(MISSING_BUILDER='1', FAIL_CREATE='1')
        self.assertNotEqual(status, 0)
        self.assertNotIn('--bootstrap', calls)

    def test_bootstrap_failure_does_not_admit_build(self):
        status, calls = self.replay(FAIL_BOOTSTRAP='1')
        self.assertNotEqual(status, 0)
        self.assertNotIn('inspect --format', calls)

    def test_invalid_builder_name_never_reaches_cli(self):
        status, calls = self.replay(FG_BUILD_BUILDER='invalid name')
        self.assertNotEqual(status, 0)
        self.assertEqual(calls, '')


if __name__ == '__main__':
    unittest.main()
