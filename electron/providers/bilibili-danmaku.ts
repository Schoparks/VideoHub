import type { DanmakuComment } from '../../src/shared/types';

const limit = 4 * 1024 * 1024;
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] || match;
    const value = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '';
  });
}

export function parseDanmaku(xml: string): DanmakuComment[] {
  if (Buffer.byteLength(xml) > limit || !/<i(?:\s[^>]*)?>/.test(xml) || !/<\/i>/.test(xml)) throw new Error('弹幕响应格式不正确');
  if (/<state>1<\/state>/.test(xml)) return [];
  const comments: DanmakuComment[] = [];
  for (const match of xml.matchAll(/<d\s+p=["']([^"']*)["'][^>]*>([^<]*)<\/d>/g)) {
    const fields = match[1].split(',');
    const time = Number(fields[0]), mode = Number(fields[1]), color = Number(fields[3]);
    const text = decode(match[2]).trim().slice(0, 200);
    if (!text || !Number.isFinite(time) || time < 0 || ![1, 2, 3, 4, 5, 6].includes(mode)
      || !Number.isInteger(color) || color < 0 || color > 0xffffff) continue;
    comments.push({ id: `${fields[7] || comments.length}:${comments.length}`, time,
      mode: mode <= 3 ? 1 : mode as 4 | 5 | 6, text, color: `#${color.toString(16).padStart(6, '0')}` });
    if (comments.length >= 20000) break;
  }
  return comments.sort((a, b) => a.time - b.time);
}

export async function fetchDanmaku(cid: number, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!Number.isSafeInteger(cid) || cid <= 0) throw new Error('此视频没有可用的弹幕标识');
  const response = await fetcher(`https://comment.bilibili.com/${cid}.xml`, {
    credentials: 'omit', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: { Accept: 'text/xml', Referer: 'https://www.bilibili.com/' },
  });
  if (!response.ok) throw new Error(`弹幕暂时无法加载（HTTP ${response.status}）`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('弹幕响应过大');
  if (!response.body) throw new Error('弹幕响应为空');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > limit) throw new Error('弹幕响应过大');
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return parseDanmaku(Buffer.concat(chunks).toString('utf8'));
}
