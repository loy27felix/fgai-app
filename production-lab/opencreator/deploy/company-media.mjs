// Native video downloaders fetch result URLs without the SDK's request headers.
// Attach the actor capability only to this actor's exact internal media route.
export function companyMediaFetch(fetchImpl, base, capability) {
  const owned=new URL(base);
  return (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let target;
    try{target=new URL(url);}catch{return fetchImpl(input,init);}
    if (method !== 'GET' || target.origin!==owned.origin || !target.pathname.startsWith(owned.pathname + '/v1/media/')) return fetchImpl(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('authorization', 'Bearer ' + capability);
    return fetchImpl(input, {...init, headers, redirect: 'error'});
  };
}
