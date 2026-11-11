import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('collector', pathlib.Path(__file__).with_name('collect-host-metrics.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class CapacityTest(unittest.TestCase):
    def test_real_smb_capacity(self):
        value = collector.parse_capacity('Filesystem 1024-blocks Used Available Capacity Mounted on\n'
            '//fgstudio@192.168.0.14/FgStudio 1000 230 770 23% /Volumes/FgStudio\n')
        self.assertEqual(value, {'totalBytes': 1024000, 'usedBytes': 235520, 'freeBytes': 788480})

    def test_local_disk_or_wrong_share_is_not_nas(self):
        for row in ['/dev/disk1 1000 230 770 23% /',
                    '//user@nas/other 1000 230 770 23% /Volumes/Other']:
            with self.assertRaises(ValueError):
                collector.parse_capacity('header\n' + row)

    def test_invalid_capacity_is_rejected(self):
        for values in ['0 0 0', '100 101 0', '100 10 -1']:
            with self.assertRaises(ValueError):
                collector.parse_capacity('//user@nas/FgStudio ' + values + ' 23% /Volumes/FgStudio')


if __name__ == '__main__':
    unittest.main()
