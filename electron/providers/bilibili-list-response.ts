import { ProviderError } from '../protocol/http';

/** A successful envelope can still contain a verification voucher rather than a list. */
export function bilibiliList(data: any, field: 'result' | 'list', label: string,
  page: number, totalField: 'numResults' | 'total'): unknown[] {
  if (data?.v_voucher) throw new ProviderError('请求被 B 站验证限制，请稍后重试', -352);
  const list = data?.[field];
  const total = data?.[totalField];
  if (Array.isArray(list)) {
    if (page === 1 && list.length === 0 && Number(total) > 0) {
      throw new ProviderError(`B 站${label}结果未完整返回，请重试`);
    }
    return list;
  }
  // Some zero-result search responses omit result; require explicit zero evidence.
  if (data && total === 0 && (list === null || list === undefined)) return [];
  throw new ProviderError(`B 站${label}响应异常，请重试`);
}
