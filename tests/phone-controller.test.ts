import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { ControllerServer } from '../electron/remote/server';
import { parseControllerCommand, controllerActions } from '../src/shared/remote-control';
import { schemas } from '../electron/ipc';

vi.mock('../electron/remote/addresses', () => ({
  controllerHosts: () => ['192.168.0.8'],
  privateAddress: (value: string) => value.startsWith('192.168.'),
}));

describe('phone command contract', () => {
  it('accepts finite semantic actions and trimmed search/HTTP/BV input', () => {
    for (const action of controllerActions) expect(parseControllerCommand({ kind: 'action', action })).toEqual({ kind: 'action', action });
    expect(parseControllerCommand({ kind: 'search', text: '  中文 搜索  ' })).toEqual({ kind: 'search', text: '中文 搜索' });
    expect(parseControllerCommand({ kind: 'url', text: 'BV1Ue4y1w7bk' })?.kind).toBe('url');
    expect(parseControllerCommand({ kind: 'url', text: 'https://example.com/video?key=a#part' })?.kind).toBe('url');
  });

  it('rejects arbitrary operations, credentials, nonweb URLs and unbounded text', () => {
    const invalid: unknown[] = [null, 'pause', { kind: 'action', action: 'logout' },
      { kind: 'search', text: '' }, { kind: 'search', text: 'x'.repeat(201) },
      { kind: 'url', text: 'file:///private/movie.mp4' }, { kind: 'url', text: 'javascript:alert(1)' },
      { kind: 'url', text: 'https://user:secret@example.com/' }, { kind: 'url', text: 'BV123' }];
    for (const input of invalid) expect(parseControllerCommand(input)).toBeUndefined();
    expect(schemas.controllerReply.safeParse(['not-an-id', {}]).success).toBe(false);
    expect(schemas.controllerReply.safeParse(['f0000000-0000-4000-8000-000000000001', { error: '/private/token' }]).success).toBe(false);
  });
});

describe('LAN controller HTTP boundaries', () => {
  let directory: string, server: ControllerServer, address: string, token: string;
  const execute = vi.fn(async () => ({}));
  const start = async () => {
    const state = await server.start();
    const url = new URL(state.urls[0]);
    address = `http://127.0.0.1:${url.port}`;
    token = url.hash.slice(1);
    return state;
  };
  const command = (body: unknown, headers = {}) => fetch(`${address}/command`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  beforeEach(async () => {
    execute.mockReset();
    execute.mockResolvedValue({});
    await mkdir('.tmp', { recursive: true });
    directory = await mkdtemp(join('.tmp', 'phone-controller-test-'));
    await writeFile(join(directory, 'remote.js'), 'console.log("controller");');
    await writeFile(join(directory, 'remote.css'), 'body { margin: 0; }');
    server = new ControllerServer(directory, execute);
    await start();
  });
  afterEach(async () => { await server.stop(); await rm(directory, { recursive: true, force: true }); });

  it('serves only bundled assets and exposes no token in HTML or unauthenticated state', async () => {
    const page = await fetch(address);
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await page.text()).not.toContain(token);
    expect((await fetch(`${address}/state`)).status).toBe(401);
    expect((await fetch(`${address}/state`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(`${address}/../package.json`)).status).toBe(401);
  });

  it('requires a bearer capability, exact Host and same Origin before command dispatch', async () => {
    expect((await command({ kind: 'action', action: 'confirm' }, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await command({ kind: 'action', action: 'confirm' }, { Origin: 'https://evil.example' })).status).toBe(403);
    const hostStatus = await new Promise<number | undefined>(resolve => {
      const request = httpRequest(`${address}/state`, { headers: { Host: 'evil.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      request.end();
    });
    expect(hostStatus).toBe(403);
    expect(execute).not.toHaveBeenCalled();
    expect((await command({ kind: 'action', action: 'confirm' }, { Origin: address })).status).toBe(200);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ kind: 'action', action: 'confirm' });
  });

  it('rejects malformed, oversized and unknown commands without invoking application APIs', async () => {
    expect((await command({ kind: 'action', action: 'preferences' })).status).toBe(400);
    expect((await command({ kind: 'search', text: 'x'.repeat(40000) })).status).toBe(413);
    const malformed = await fetch(`${address}/command`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns the actual receiver failure and rotates the capability after disable', async () => {
    const failing = new ControllerServer(directory, async () => ({ error: 'blocked' }));
    try {
      const url = new URL((await failing.start()).urls[0]);
      const reply = await fetch(`http://127.0.0.1:${url.port}/command`, {
        method: 'POST', headers: { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'search', text: '电影' }),
      });
      expect(await reply.json()).toEqual({ error: 'blocked' });
    } finally { await failing.stop(); }
    const oldToken = token;
    expect(await server.stop()).toEqual({ enabled: false, urls: [] });
    await start();
    expect(token).not.toBe(oldToken);
    expect((await command({ kind: 'action', action: 'back' }, { Authorization: `Bearer ${oldToken}` })).status).toBe(401);
    const states = await Promise.all([server.start(), server.start()]);
    expect(states[0]).toEqual(states[1]);
  });

  it('bounds simultaneous dispatch after independently uploaded request bodies', async () => {
    const releases: ((value: {}) => void)[] = [];
    execute.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
    const requests = Array.from({ length: 5 }, () => command({ kind: 'action', action: 'down' }));
    let replies: Response[] = [];
    try {
      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
    } finally {
      releases.forEach(release => release({}));
      replies = await Promise.all(requests);
    }
    expect(replies.filter(reply => reply.status === 429)).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
