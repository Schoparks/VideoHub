import { describe, expect, it } from 'vitest';
import { bilibiliList } from '../electron/providers/bilibili-list-response';
import { searchBilibili } from '../electron/providers/bilibili-search';
import { normalizeVideo } from '../electron/providers/bilibili';

describe('Bilibili empty response versus missing search/cinema results', () => {
  it('rejects verification vouchers in a successful envelope without exposing their contents', async () => {
    await expect(searchBilibili({ kind: 'search', keyword: '黑袍纠察队', searchType: 'media_ft' },
      async () => ({ v_voucher: 'secret-voucher' }), normalizeVideo)).rejects.toThrow('验证限制');
    try { bilibiliList({ v_voucher: 'secret-voucher' }, 'list', '影视', 1, 'total'); }
    catch (error) { expect(String(error)).not.toContain('secret-voucher'); }
  });

  it('keeps malformed and incomplete lists retryable instead of presenting no content', () => {
    for (const data of [undefined, null, {}, { result: {} }, { result: [], numResults: 1 }]) {
      expect(() => bilibiliList(data, 'result', '搜索', 1, 'numResults')).toThrow('重试');
    }
    expect(() => bilibiliList({ list: [], total: 24 }, 'list', '影视', 1, 'total')).toThrow('未完整');
  });

  it('accepts real empty lists and an explicitly empty omitted list', () => {
    expect(bilibiliList({ result: [], numResults: 0 }, 'result', '搜索', 1, 'numResults')).toEqual([]);
    expect(bilibiliList({ numResults: 0 }, 'result', '搜索', 1, 'numResults')).toEqual([]);
    expect(bilibiliList({ result: [], numResults: 1 }, 'result', '搜索', 2, 'numResults')).toEqual([]);
    const list = [{ season_id: 42 }, { season_id: 43 }];
    expect(bilibiliList({ list, total: 2 }, 'list', '影视', 1, 'total')).toBe(list);
  });
});
