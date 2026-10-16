import { native, nativeTask } from './native';
import { installAbortSignals } from './abort-signals';

/** Native requests bypass WebView CORS; account headers remain in the isolated backend. */
export const nativeFetch: typeof fetch = async (input, options = {}) => {
  const url = input instanceof Request ? input.url : String(input);
  const headers = Object.fromEntries(new Headers(options.headers).entries());
  const result = await nativeTask(id => native.request(id, JSON.stringify({
    url, headers, method: options.method || 'GET', body: options.body?.toString(),
    redirect: options.redirect || 'follow',
  })), options.signal || undefined);
  const bytes = Uint8Array.from(atob(result.body), value => value.charCodeAt(0));
  const response = new Response([204, 205, 304].includes(result.status) ? null : bytes, { status: result.status, headers: result.headers });
  Object.defineProperty(response, 'url', { value: result.url });
  Object.defineProperty(response.headers, 'getSetCookie', { value: () => result.cookies || [] });
  return response;
};

export function installFetch() {
  window.fetch = nativeFetch;
  installAbortSignals();
}
