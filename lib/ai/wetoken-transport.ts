import { Agent, type Dispatcher } from 'undici';

export const WETOKEN_CONNECT_TIMEOUT_MS = 60_000;

// Keep provider connection attempts open long enough for the NAS network path.
// 给 NAS 到 Provider 的连接留出足够时间，避免 Undici 默认 10 秒连接超时。
export const wetokenProviderDispatcher = new Agent({
  connect: { timeout: WETOKEN_CONNECT_TIMEOUT_MS },
});

export type WetokenFetcherInit = RequestInit & { dispatcher?: Dispatcher };
export type WetokenFetcher = (input: string | URL | Request, init?: WetokenFetcherInit) => Promise<Response>;
