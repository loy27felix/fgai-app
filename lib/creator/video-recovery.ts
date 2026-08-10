export type VideoRecoveryFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function isVideoContentType(contentType: string, url: string) {
  const normalized = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalized.startsWith('video/')) return true;
  if (
    normalized === 'application/octet-stream' &&
    /(?:\.mp4|\.mov)(?:[?#]|$)|\/content(?:[/?#]|$)/i.test(url)
  ) {
    return true;
  }
  return (
    !normalized &&
    /(?:\.mp4|\.mov)(?:[?#]|$)|\/content(?:[/?#]|$)/i.test(url)
  );
}

/**
 * Verify that a recovery URL returns media bytes rather than a JSON error,
 * expired signed URL, or an empty response. A tiny range keeps this probe
 * cheap while still exercising the same URL the video element will use.
 */
export async function assertPlayableVideoUrl(
  url: string,
  options: { fetcher?: VideoRecoveryFetcher; signal?: AbortSignal } = {},
) {
  const fetcher = options.fetcher || fetch;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1' },
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (error) {
    throw new Error(
      `Video URL is unreachable: ${error instanceof Error ? error.message : 'network request failed'}`,
    );
  }

  if (!response.ok && response.status !== 206) {
    throw new Error(`Video URL is unavailable (HTTP ${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!isVideoContentType(contentType, url)) {
    throw new Error('Recovery endpoint did not return a playable video file');
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength === '0') throw new Error('Recovery endpoint returned an empty video file');

  try {
    await response.body?.cancel();
  } catch {
    // Best effort: this is only a short probe request.
  }
  return { contentType: contentType || 'video/mp4', status: response.status };
}
