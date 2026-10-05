// Native video downloaders fetch result URLs without the SDK's request headers.
// Attach the actor capability only to this actor's exact internal media route.
export function companyMediaFetch(fetchImpl, base, capability) {
  return (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' || !url.startsWith(base + '/v1/media/')) return fetchImpl(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('authorization', 'Bearer ' + capability);
    return fetchImpl(input, {...init, headers, redirect: 'error'});
  };
}
