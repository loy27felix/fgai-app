"""Free transport checks: no provider credentials or paid requests."""
import asyncio
import unittest
import httpx
from company_request import install, fg_task, sdk_operation_env

BASE = 'http://fg-gateway:3010/internal/arcreel/test'
install(BASE, 'fixture-capability')

class RequestTests(unittest.IsolatedAsyncioTestCase):
    def test_synchronous_ark_submit_keeps_operation_identity_and_task(self):
        seen = []

        def respond(request):
            seen.append(request.headers.get('x-fg-operation-id'))
            return httpx.Response(200, headers={'x-fg-task-id': 'video-task'}, json={})

        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            request = client.build_request('POST', BASE+'/v1/contents/generations/tasks', json={})
            client.send(request)
            self.assertEqual(fg_task.get(), 'video-task')
            client.send(request)
            client.post(BASE+'/v1/contents/generations/tasks', json={})
            client.post(BASE+'-other/v1/contents/generations/tasks', json={})
        self.assertIsNotNone(seen[0])
        self.assertEqual(seen[0], seen[1])
        self.assertNotEqual(seen[1], seen[2])
        self.assertIsNone(seen[3])

    def test_sdk_process_identity_preserves_headers_and_unrelated_providers(self):
        source = {'ANTHROPIC_BASE_URL': BASE, 'ANTHROPIC_CUSTOM_HEADERS': 'x-fixture: preserved\nx-fg-operation-id: stale'}
        first = sdk_operation_env(source, BASE)
        second = sdk_operation_env(source, BASE)
        self.assertIn('x-fixture: preserved', first['ANTHROPIC_CUSTOM_HEADERS'])
        self.assertNotIn('stale', first['ANTHROPIC_CUSTOM_HEADERS'])
        self.assertEqual(first['ANTHROPIC_CUSTOM_HEADERS'].count('x-fg-operation-id:'), 1)
        self.assertNotEqual(first['ANTHROPIC_CUSTOM_HEADERS'], second['ANTHROPIC_CUSTOM_HEADERS'])
        self.assertIn('stale', source['ANTHROPIC_CUSTOM_HEADERS'])
        other = {'ANTHROPIC_BASE_URL': BASE+'-other'}
        self.assertIs(sdk_operation_env(other, BASE), other)

    async def test_download_auth_never_reaches_another_actor_or_external_url(self):
        seen = []
        def respond(request):
            seen.append(request.headers.get('authorization'))
            return httpx.Response(200)
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            await client.get(BASE+'/v1/media/result')
            await client.get(BASE+'-other/v1/media/result')
            await client.get('http://other/result')
        self.assertEqual(seen, ['Bearer fixture-capability', None, None])

    async def test_explicit_regeneration_and_transport_replay(self):
        seen = []
        def respond(request):
            seen.append(request.headers.get('x-fg-operation-id'))
            return httpx.Response(200, headers={'x-fg-task-id': 'owned-task'}, json={})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            request = client.build_request('POST', BASE+'/v1/images/generations', json={'prompt':'same'})
            await client.send(request)
            self.assertEqual(fg_task.get(), 'owned-task')
            await client.send(request)
            await client.post(BASE+'/v1/images/generations', json={'prompt':'same'})
            self.assertEqual(seen[0], seen[1])
            self.assertNotEqual(seen[1], seen[2])
            await client.get('http://unrelated/health')
            self.assertIsNone(seen[3])

if __name__ == '__main__':
    unittest.main()
