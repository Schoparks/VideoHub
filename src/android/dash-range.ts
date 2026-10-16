interface Request { url: string; headers?: Record<string, string> }

/** The virtual capability keeps the range; WebView must not apply it to the sliced body again. */
export async function androidDashRange<T extends Request>(request: T): Promise<T> {
  if (window.hubPlatform !== 'android' || !request.headers) return request;
  const address = new URL(request.url);
  if (address.origin !== 'https://app.yingji.local' || !address.pathname.startsWith('/media/')) return request;
  const key = Object.keys(request.headers).find(key => key.toLowerCase() === 'range');
  if (!key || !/^bytes=\d+-\d*$/.test(request.headers[key])) return request;
  address.searchParams.set('range', request.headers[key].slice(6));
  const headers = { ...request.headers };
  delete headers[key];
  return { ...request, url: address.href, headers };
}
