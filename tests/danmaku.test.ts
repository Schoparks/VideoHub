import { describe, expect, it, vi } from 'vitest';
import { fetchDanmaku, parseDanmaku } from '../electron/providers/bilibili-danmaku';
import { layoutDanmaku, visibleDanmaku } from '../src/shared/danmaku-layout';
import { defaultPreferences, type DanmakuComment } from '../src/shared/types';
import { schemas } from '../electron/ipc';

const xml = '<i><d p="3.8,4,25,15138834,0,0,hash,1">固定&amp;安全</d><d p="1,1,25,16777215,0,0,hash,2">&lt;img&gt;&#x4F60;&#22909;</d></i>';
const comment = (id: string, time: number, mode: DanmakuComment['mode'] = 1): DanmakuComment =>
  ({ id, time, mode, text: '测试弹幕', color: '#ffffff' });

describe('Bilibili video danmaku', () => {
  it('decodes plain text and Unicode, retains color/mode and sorts by media time', () => {
    const data = parseDanmaku(xml);
    expect(data.map(item => [item.time, item.mode, item.text])).toEqual([[1, 1, '<img>你好'], [3.8, 4, '固定&安全']]);
    expect(data[0].color).toBe('#ffffff');
  });
  it('rejects non-XML responses and ignores invalid and advanced executable modes', () => {
    expect(() => parseDanmaku('<html>blocked</html>')).toThrow();
    expect(parseDanmaku('<i><state>1</state></i>')).toEqual([]);
    const entries = [-1, Infinity, 10].map(time => `<d p="${time},7,25,16777215,0,0,h,1">advanced</d>`);
    expect(parseDanmaku(`<i>${entries.join('')}</i>`)).toEqual([]);
  });
  it('requests only the fixed anonymous comment endpoint with no credentials or redirects', async () => {
    const fetcher = vi.fn(async () => new Response(xml));
    expect(await fetchDanmaku(279786, undefined, fetcher as typeof fetch)).toHaveLength(2);
    expect(fetcher.mock.calls[0]).toMatchObject(['https://comment.bilibili.com/279786.xml', {
      credentials: 'omit', redirect: 'error', headers: { Accept: 'text/xml', Referer: 'https://www.bilibili.com/' },
    }]);
    await expect(fetchDanmaku(-1, undefined, fetcher as typeof fetch)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps HTTP failure and excessive responses as failures rather than empty comments', async () => {
    await expect(fetchDanmaku(1, undefined, (async () => new Response('', { status: 403 })) as typeof fetch)).rejects.toThrow('HTTP 403');
    await expect(fetchDanmaku(1, undefined, (async () => new Response('x'.repeat(4 * 1024 * 1024 + 1))) as typeof fetch)).rejects.toThrow('过大');
  });
});

describe('danmaku media-clock layout', () => {
  it('avoids overlapping lane entries and respects the configured area', () => {
    const data = layoutDanmaku([comment('a', 1), comment('b', 1.1), comment('c', 3)], 800, 200, 25, .5, () => 100);
    expect(data).toHaveLength(3);
    expect(data[0].y).not.toBe(data[1].y);
    expect(data[2].y).toBe(data[0].y);
    expect(data.every(item => item.y + 35 <= 100)).toBe(true);
  });
  it('restores the correct comments after a backward or forward seek without replaying stale ones', () => {
    const data = layoutDanmaku([comment('a', 1, 5), comment('b', 20, 4)], 800, 400, 25, .5, () => 100);
    expect(visibleDanmaku(data, 2).map(item => item.id)).toEqual(['a']);
    expect(visibleDanmaku(data, 10)).toEqual([]);
    expect(visibleDanmaku(data, 21).map(item => item.id)).toEqual(['b']);
    expect(visibleDanmaku(data, 2).map(item => item.id)).toEqual(['a']);
  });
  it('does not mix opposing scrolling directions in an occupied lane', () => {
    const data = layoutDanmaku([comment('a', 1), comment('b', 2, 6)], 800, 100, 25, .5, () => 100);
    expect(data.map(item => item.id)).toEqual(['a']);
  });
});

describe('playback settings contract', () => {
  it('fills additive defaults for older preferences without changing the selected end behavior', () => {
    const { danmaku, danmakuArea, danmakuFontSize, danmakuOpacity, playbackRate, ...older } = defaultPreferences;
    expect(schemas.preferences.parse([{ ...older, autoNext: false }])[0]).toEqual({ ...defaultPreferences, autoNext: false });
  });
  it('rejects out-of-range visual and speed settings and non-session identifiers', () => {
    for (const change of [{ danmakuOpacity: 0 }, { danmakuArea: .7 }, { danmakuFontSize: 100 }, { playbackRate: 10 }]) {
      expect(schemas.preferences.safeParse([{ ...defaultPreferences, ...change }]).success).toBe(false);
    }
    expect(schemas.danmaku.safeParse(['https://other.example']).success).toBe(false);
  });
});
