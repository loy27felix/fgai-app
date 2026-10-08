import {requestPath} from './policy.mjs';

export function publicEntryOrigins(value) {
 if (!value) return [];
 const url = new URL(value);
 if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Invalid external FG origin');
 return [url.origin];
}

export function workspaceRequestPath(raw, origin, prefix = '/fg-six') {
 const original = requestPath(raw, origin);
 if (original.url.pathname === prefix || original.url.pathname.startsWith(prefix + '/')) {
  return requestPath((original.url.pathname.slice(prefix.length) || '/') + original.url.search, origin);
 }
 return original;
}

export function workspaceEntryURL(host, externalOrigins, fallback) {
 return externalOrigins.some(origin => new URL(origin).host === host) ? '/fg-six/' : new URL(fallback).origin + '/';
}
