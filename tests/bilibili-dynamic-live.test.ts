import { describe, expect, it } from 'vitest';
import { normalizeDynamic } from '../electron/providers/bilibili';
import { normalizeDynamicLive } from '../electron/providers/bilibili-dynamic-live';
import { schemas } from '../electron/ipc';
import { BilibiliProvider } from '../electron/providers/bilibili';
import { BilibiliAccount } from '../electron/accounts/bilibili-account';
import { Vault } from '../electron/accounts/vault';

const room = { room_id: 5441, title: '解说比赛', live_status: 1, cover: '//i0.hdslb.com/live.jpg' };
const major = { live_rcmd: { content: JSON.stringify({ live_play_info: room, type: 1 }) } };
const dynamic = (major: unknown) => ({ id_str: '123', modules: {
  module_author: { name: '主播', pub_ts: 1700000000 }, module_dynamic: { major },
} });

describe('dynamic live notifications', () => {
  it('retains embedded cover, title, status and room identity as a playable card', () => {
    const entry = normalizeDynamic(dynamic(major));
    expect(entry.video).toEqual({ id: 'live:5441', roomId: 5441, title: '解说比赛',
      source: 'bilibili', kind: 'live', cover: 'https://i0.hdslb.com/live.jpg', author: '主播', badge: '直播中' });
    expect(schemas.resolve.safeParse([entry.video]).success).toBe(true);
  });
  it('retains forwarded live notices and supports direct live-card fields', () => {
    const entry = normalizeDynamic({ ...dynamic({}), orig: dynamic(major) });
    expect(entry.original?.video?.roomId).toBe(5441);
    expect(normalizeDynamicLive({ live: { ...room, room_id: undefined, id: 5441 } }, '主播')?.roomId).toBe(5441);
  });
  it('ignores malformed and invalid notices without aborting the surrounding feed', () => {
    for (const content of ['{', '{}', JSON.stringify({ live_play_info: { room_id: -1 } }), 'x'.repeat(200001)]) {
      expect(normalizeDynamicLive({ live_rcmd: { content } }, '主播')).toBeUndefined();
    }
    expect(normalizeDynamic(dynamic({ live_rcmd: { content: '{' } })).author).toBe('主播');
  });
  it('keeps live notices in all dynamics while retaining the video-only filter contract', async () => {
    const vault = new Vault('', { available: () => false, encrypt: Buffer.from, decrypt: x => x.toString() });
    vault.value.cookie = 'SESSDATA=test';
    const provider = new BilibiliProvider(new BilibiliAccount(vault, async () => new Response(JSON.stringify({
      code: 0, data: { items: [dynamic(major), { ...dynamic({ archive: { aid: 42, title: '视频' } }), id_str: '124' }], has_more: false },
    }))));
    expect((await provider.browse({ kind: 'dynamic', dynamicType: 'all' })).dynamics).toHaveLength(2);
    const videos = await provider.browse({ kind: 'dynamic', dynamicType: 'video' });
    expect(videos.dynamics).toHaveLength(1);
    expect(videos.items[0].kind).toBe('video');
  });
});
