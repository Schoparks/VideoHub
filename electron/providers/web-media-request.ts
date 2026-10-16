import { randomUUID } from 'node:crypto';
import type { Session } from 'electron';
import { httpMediaUrl } from './url-media';

interface Pending { address: string; redirects: number; error?: Error }
const marker = 'X-Yingji-Media-Request';

/** Track each Chromium request independently; net.fetch omits the final Response.url. */
export function createWebMediaRequest(
  isolated: Session,
  onRedirect?: (id: number, from: string, to: string) => void,
) {
  const pending = new Map<string, Pending>();
  const requests = new Map<number, Pending>();
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const state = requests.get(details.id);
    let allowed = false;
    try {
      const protocol = new URL(details.url).protocol;
      allowed = ['data:', 'blob:'].includes(protocol) || !!httpMediaUrl(details.url);
    } catch { /* Remote pages cannot navigate to file/app/custom protocols. */ }
    callback({ cancel: !allowed || !!state?.error });
  });
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    const key = Object.keys(headers).find(name => name.toLowerCase() === marker.toLowerCase());
    if (key) {
      const state = pending.get(headers[key]);
      if (state) requests.set(details.id, state);
      delete headers[key];
    }
    // Apply strict-origin referrer policy even to explicitly supplied media headers.
    const ref = Object.keys(headers).find(name => name.toLowerCase() === 'referer');
    if (ref) {
      try {
        const origin = new URL(headers[ref]), target = new URL(details.url);
        if (origin.protocol === 'https:' && target.protocol === 'http:') delete headers[ref];
        else if (origin.origin !== target.origin) headers[ref] = `${origin.origin}/`;
      } catch { delete headers[ref]; }
    }
    callback({ requestHeaders: headers });
  });
  isolated.webRequest.onBeforeRedirect(details => {
    onRedirect?.(details.id, details.url, details.redirectURL);
    const state = requests.get(details.id);
    if (!state) return;
    try {
      state.address = httpMediaUrl(details.redirectURL, details.url);
      if (++state.redirects > 5) throw new Error('网页媒体重定向过多');
    } catch (error) { state.error = error instanceof Error ? error : new Error('网页媒体重定向无法完成'); }
  });
  const request: typeof fetch = async (input, init) => {
    const address = httpMediaUrl(input instanceof Request ? input.url : String(input));
    const state: Pending = { address, redirects: 0 };
    const token = randomUUID();
    pending.set(token, state);
    const headers = new Headers(init?.headers);
    headers.set(marker, token);
    headers.set('User-Agent', isolated.getUserAgent());
    try {
      const response = await isolated.fetch(address, { ...init, headers, credentials: 'include', redirect: 'follow' });
      if (state.error) { await response.body?.cancel(); throw state.error; }
      Object.defineProperty(response, 'url', { value: state.address });
      return response;
    } finally {
      pending.delete(token);
      for (const [id, value] of requests) if (value === state) requests.delete(id);
    }
  };
  const dispose = () => {
    isolated.webRequest.onBeforeRequest(null);
    isolated.webRequest.onBeforeSendHeaders(null);
    isolated.webRequest.onBeforeRedirect(null);
    pending.clear();
    requests.clear();
  };
  return { request, dispose };
}
