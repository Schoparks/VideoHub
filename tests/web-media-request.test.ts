import { describe, expect, it, vi } from 'vitest';
import type { Session } from 'electron';
import { createWebMediaRequest } from '../electron/providers/web-media-request';

function fixture(observer?: (id: number, from: string, to: string) => void) {
  let id = 0;
  const callbacks: Record<string, any> = {};
  const sent: { url: string; headers: Record<string, string> }[] = [];
  const routes = new Map<string, string>();
  const isolated = {
    getUserAgent: () => 'fixture-UA',
    webRequest: Object.fromEntries(['onBeforeRequest', 'onBeforeSendHeaders', 'onBeforeRedirect']
      .map(name => [name, (callback: unknown) => { callbacks[name] = callback; }])),
    fetch: vi.fn(async (initial: string, init?: RequestInit) => {
      const requestId = ++id;
      let address = initial;
      let headers = Object.fromEntries(new Headers(init?.headers));
      while (true) {
        let canceled = false;
        callbacks.onBeforeRequest({ id: requestId, url: address }, (value: { cancel: boolean }) => { canceled = value.cancel; });
        if (canceled) throw new Error('request canceled');
        callbacks.onBeforeSendHeaders({ id: requestId, url: address, requestHeaders: headers },
          (value: { requestHeaders: Record<string, string> }) => { headers = value.requestHeaders; });
        sent.push({ url: address, headers: { ...headers } });
        const target = routes.get(address);
        if (!target) return new Response('manifest');
        callbacks.onBeforeRedirect({ id: requestId, url: address, redirectURL: target });
        address = new URL(target, address).href;
      }
    }),
  } as unknown as Session;
  return { isolated, routes, sent, callbacks, network: createWebMediaRequest(isolated, observer) };
}

describe('isolated webpage media requests', () => {
  it('reports redirect identity to availability tracking without replacing redirect limits or final address', async () => {
    const observer = vi.fn();
    const { network, routes } = fixture(observer);
    routes.set('https://small.example/entry', 'https://cdn.example/video.mp4');
    const response = await network.request('https://small.example/entry');
    expect(observer).toHaveBeenCalledWith(1, 'https://small.example/entry', 'https://cdn.example/video.mp4');
    expect(response.url).toBe('https://cdn.example/video.mp4');
  });

  it('tracks final addresses, keeps own-session cookies and never sends the internal marker', async () => {
    const { network, routes, sent, isolated } = fixture();
    routes.set('https://small.example/entry', '/assets/main.m3u8');
    const response = await network.request('https://small.example/entry', { headers: { Referer: 'https://small.example/watch' } });
    expect(response.url).toBe('https://small.example/assets/main.m3u8');
    expect(sent[1].headers.referer).toBe('https://small.example/watch');
    expect(sent[1].headers['user-agent']).toBe('fixture-UA');
    expect(sent.every(value => !Object.keys(value.headers).some(key => key.includes('yingji')))).toBe(true);
    expect(isolated.fetch).toHaveBeenCalledWith('https://small.example/entry', expect.objectContaining({ credentials: 'include' }));
  });

  it('reduces cross-host referrers and removes HTTPS downgrade referrers', async () => {
    const { network, routes, sent } = fixture();
    routes.set('https://small.example/entry', 'https://cdn.example/media');
    routes.set('https://cdn.example/media', 'http://cdn.example/media');
    const response = await network.request('https://small.example/entry', { headers: { Referer: 'https://small.example/watch?private=1' } });
    expect(response.url).toBe('http://cdn.example/media');
    expect(sent[1].headers.referer).toBe('https://small.example/');
    expect(sent[2].headers.referer).toBeUndefined();
  });

  it('cancels forbidden redirects and loops before sending the next request, then releases handlers', async () => {
    for (const target of ['file:///secret', 'https://user:password@cdn.example/video', 'https://small.example/entry']) {
      const { network, routes, sent, callbacks } = fixture();
      routes.set('https://small.example/entry', target);
      await expect(network.request('https://small.example/entry')).rejects.toThrow();
      expect(sent.length).toBe(target.endsWith('/entry') ? 6 : 1);
      network.dispose();
      expect(Object.values(callbacks).every(callback => callback === null)).toBe(true);
    }
  });
});
