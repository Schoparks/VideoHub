import type { BilibiliAccount } from '../accounts/bilibili-account';
import type { MediaItem, Page } from '../../src/shared/types';
import { normalizeVideo } from './bilibili';

/** Video-page related results; never enters or changes the App recommendation session. */
export async function relatedBilibili(account: BilibiliAccount, item: MediaItem): Promise<Page> {
  if (item.source !== 'bilibili' || item.kind !== 'video' || !(item.bvid || item.aid)) {
    return { items: [], hasMore: false };
  }
  const data = await account.http.get('https://api.bilibili.com/x/web-interface/archive/related',
    item.bvid ? { bvid: item.bvid } : { aid: item.aid });
  if (!Array.isArray(data)) throw new Error('相关推荐返回异常，请重试');
  return { items: data.map(normalizeVideo), hasMore: false };
}
