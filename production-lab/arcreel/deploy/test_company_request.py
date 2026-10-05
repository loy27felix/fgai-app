"""Free transport checks: no provider credentials or paid requests."""
import asyncio
import unittest
import httpx
from company_request import install, fg_task

BASE = 'http://fg-gateway:3010/internal/arcreel/test'
install(BASE, 'fixture-capability')

class RequestTests(unittest.IsolatedAsyncioTestCase):
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
