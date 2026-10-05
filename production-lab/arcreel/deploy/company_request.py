"""Give each SDK operation an identity and retain its FG task for billing."""
from contextvars import ContextVar
from uuid import uuid4

fg_task = ContextVar('fg_task', default=None)

def install(base):
    import httpx
    original = httpx.AsyncClient.send

    async def send(self, request, **kwargs):
        managed = str(request.url).startswith(base + '/v1/')
        if managed and request.method == 'POST':
            # The request object retains its identity if a transport reuses it.
            # A deliberate new generation, even with identical text, is new.
            if 'x-fg-operation-id' not in request.headers:
                request.headers['x-fg-operation-id'] = str(uuid4())
            fg_task.set(None)
        response = await original(self, request, **kwargs)
        if managed and response.headers.get('x-fg-task-id'):
            fg_task.set(response.headers['x-fg-task-id'])
        return response

    httpx.AsyncClient.send = send
