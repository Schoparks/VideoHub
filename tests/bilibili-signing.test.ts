import { describe, expect, it } from 'vitest';
import { BiliHttp } from '../electron/protocol/http';
import { BilibiliSigning } from '../electron/protocol/bilibili-signing';
import { wbiParams } from '../electron/protocol/signing';

const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, data }));
const keys = (character: string) => ({ wbi_img: {
  img_url: `https://i0.hdslb.com/${character.repeat(32)}.png`,
  sub_url: `https://i0.hdslb.com/${'b'.repeat(32)}.png`,
} });

describe('shared Bilibili signing keys', () => {
  it('shares key loading for concurrent categories and retries after failed loading', async () => {
    let nav = 0;
    const pending: ((value: Response) => void)[] = [];
    const fetcher: typeof fetch = async input => {
      if (new URL(String(input)).pathname.endsWith('/nav')) {
        nav++;
        return new Promise(resolve => pending.push(resolve));
      }
      return response({ result: [] });
    };
    const signing = new BilibiliSigning(new BiliHttp(() => '', fetcher));
    const requests = Array.from({ length: 4 }, () => signing.get('/x/web-interface/wbi/search/type', {}));
    expect(nav).toBe(1);
    pending.shift()!(new Response('invalid'));
    expect((await Promise.allSettled(requests)).every(result => result.status === 'rejected')).toBe(true);
    const retry = signing.get('/x/web-interface/wbi/search/type', {});
    expect(nav).toBe(2);
    pending.shift()!(response(keys('a')));
    await expect(retry).resolves.toEqual({ result: [] });
    await signing.get('/x/web-interface/wbi/search/type', {});
    expect(nav).toBe(2);
  });

  it('does not cache keys from a load invalidated by an account reset', async () => {
    const pending: ((value: Response) => void)[] = [];
    const signed: URL[] = [];
    const fetcher: typeof fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/nav')) return new Promise(resolve => pending.push(resolve));
      signed.push(url);
      return response({});
    };
    const signing = new BilibiliSigning(new BiliHttp(() => '', fetcher));
    const old = signing.get('/search', {});
    signing.reset();
    const current = signing.get('/search', {});
    pending[1](response(keys('c')));
    await current;
    pending[0](response(keys('a')));
    await old;
    await signing.get('/search', {});
    const expected = new URLSearchParams(wbiParams({}, 'c'.repeat(32), 'b'.repeat(32),
      Number(signed[2].searchParams.get('wts'))));
    expect(signed[2].searchParams.get('w_rid')).toBe(expected.get('w_rid'));
  });

  it('shares a single replacement load after concurrent expired-signature rejections', async () => {
    let nav = 0;
    let fail = true;
    const fetcher: typeof fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/nav')) return response(keys(++nav === 1 ? 'a' : 'c'));
      return fail && nav === 1 ? response(null, -403) : response({});
    };
    const signing = new BilibiliSigning(new BiliHttp(() => '', fetcher));
    await Promise.all(Array.from({ length: 4 }, () => signing.get('/search', {})));
    expect(nav).toBe(2);
    fail = false;
    await signing.get('/search', {});
    expect(nav).toBe(2);
  });
});
