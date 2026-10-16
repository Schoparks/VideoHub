import { describe, expect, it } from 'vitest';
import { normalizeLive } from '../electron/providers/bilibili-live';
import { schemas } from '../electron/ipc';
import { BilibiliProvider } from '../electron/providers/bilibili';
import { BilibiliAccount } from '../electron/accounts/bilibili-account';
import { Vault } from '../electron/accounts/vault';

describe('live room references and artwork', () => {
  it('uses room_cover from the actual following response instead of the avatar', () => {
    const item = normalizeLive({ roomid: 42, room_cover: '//i0.hdslb.com/room.jpg',
      face: '//i0.hdslb.com/avatar.jpg', live_status: 1 });
    expect(item.cover).toBe('https://i0.hdslb.com/room.jpg');
    expect(normalizeLive({ roomid: 42, room_cover: '', keyframe: '//i0.hdslb.com/frame.jpg' }).cover)
      .toBe('https://i0.hdslb.com/frame.jpg');
  });
  it('retains following covers supplied as cover_from_user and normalizes HTTPS', () => {
    const item = normalizeLive({ roomid: 42, cover_from_user: 'http://i0.hdslb.com/follow.jpg',
      title: '<em>直播</em>', uname: '主播', live_status: '1' });
    expect(item).toMatchObject({ roomId: 42, cover: 'https://i0.hdslb.com/follow.jpg',
      title: '直播', author: '主播', badge: '直播中' });
    expect(schemas.resolve.safeParse([item]).success).toBe(true);
  });
  it('prefers uploaded artwork, falls back to valid keyframes and preserves actual state', () => {
    expect(normalizeLive({ room_id: 42, user_cover: '//i0.hdslb.com/upload.jpg',
      cover: '//i0.hdslb.com/frame.jpg', live_status: 2 }))
      .toMatchObject({ cover: 'https://i0.hdslb.com/upload.jpg', badge: '轮播中' });
    expect(normalizeLive({ roomid: 42, cover_from_user: ' ', cover: 'javascript:bad',
      keyframe: '//i0.hdslb.com/frame.jpg', live_status: '0' }))
      .toMatchObject({ cover: 'https://i0.hdslb.com/frame.jpg', badge: '未开播' });
    expect(normalizeLive({ roomid: 42, face: '//i0.hdslb.com/avatar.jpg' }).cover).toBeUndefined();
  });
  it('accepts following and live search through IPC but rejects the removed plaza', () => {
    expect(schemas.browse.safeParse([{ kind: 'followingLive' }]).success).toBe(true);
    expect(schemas.browse.safeParse([{ kind: 'search', searchType: 'live_room' }]).success).toBe(true);
    expect(schemas.browse.safeParse([{ kind: 'live' }]).success).toBe(false);
  });
  it('requests only the authenticated following endpoint and preserves service ordering', async () => {
    const requests: URL[] = [];
    const vault = new Vault('', { available: () => false, encrypt: Buffer.from, decrypt: value => value.toString() });
    vault.value = { cookie: 'SESSDATA=fixture', webMid: '42' };
    const provider = new BilibiliProvider(new BilibiliAccount(vault, async input => {
      requests.push(new URL(String(input)));
      return new Response(JSON.stringify({ code: 0, data: { rooms: [
        { roomid: 7, cover_from_user: '//i0.hdslb.com/7.jpg', live_status: 1 },
        { roomid: 3, cover_from_user: '//i0.hdslb.com/3.jpg', live_status: 0 },
      ], has_more: true } }));
    }));
    const page = await provider.browse({ kind: 'followingLive', page: 2 });
    expect(requests[0].pathname).toBe('/xlive/web-ucenter/user/following');
    expect(requests[0].searchParams.get('page')).toBe('2');
    expect(page.items.map(item => item.roomId)).toEqual([7, 3]);
    expect(page.hasMore).toBe(true);
  });
});
