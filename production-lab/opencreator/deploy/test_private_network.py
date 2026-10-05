import ast
import hashlib
import ipaddress
import json
import pathlib
import unittest


class PrivateNetworkTest(unittest.TestCase):
    def test_allocations_avoid_lan_ipv6_and_existing_user_network(self):
        source = ast.parse(pathlib.Path(__file__).with_name('provision.py').read_text())
        allocate = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'safe_subnet')
        occupied = [{'IPAM': {'Config': None}}, {'IPAM': {'Config': [{'Subnet': '192.168.0.0/20'}, {'Subnet': 'fd00::/64'}]}}]
        def run(args):
            return 'example' if args[1] == 'ls' else json.dumps(occupied)
        namespace = {'hashlib': hashlib, 'ipaddress': ipaddress, 'json': json, 'run': run}
        exec(compile(ast.Module(body=[allocate], type_ignores=[]), '<network allocator>', 'exec'), namespace)
        first = namespace['safe_subnet']('same-user')
        occupied.append({'IPAM': {'Config': [{'Subnet': first}]}})
        second = namespace['safe_subnet']('same-user')
        self.assertNotEqual(first, second)
        for value in (first, second):
            self.assertTrue(ipaddress.ip_network(value).subnet_of(ipaddress.ip_network('10.208.0.0/12')))
            self.assertFalse(ipaddress.ip_network(value).overlaps(ipaddress.ip_network('192.168.0.0/20')))


if __name__ == '__main__':
    unittest.main()
