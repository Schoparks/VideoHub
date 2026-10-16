import { USER_AGENT } from '../electron/protocol/http';
import { mp4Protection } from '../electron/playback/mp4-protection';

/** Read only a bounded initialization header. No samples, cookies, keys or output addresses. */
export async function auditAvc(track: any) {
  try {
    const range = (track.SegmentBase || track.segment_base)?.Initialization
      || track.segment_base?.initialization;
    const match = /^0-(\d+)$/.exec(range || '');
    if (!match || Number(match[1]) >= 65536) return { status: 'unavailable' };
    const url = new URL(track.baseUrl || track.base_url);
    const allowed = ['bilivideo.com', 'bilivideo.cn', 'akamaized.net']
      .some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowed) return { status: 'unavailable' };
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT,
      Referer: 'https://www.bilibili.com/', Range: `bytes=${range}` },
      redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${range}/`)) {
      await response.body?.cancel();
      return { status: 'unavailable' };
    }
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > Number(match[1]) + 1) { await reader.cancel(); return { status: 'unavailable' }; }
      chunks.push(next.value);
    }
    const bytes = Buffer.concat(chunks);
    if (size !== Number(match[1]) + 1 || mp4Protection(bytes) !== 'clear') return { status: 'unavailable' };
    const walk = (start: number, end: number, depth = 0): Buffer | undefined => {
      if (depth > 10) throw new Error();
      for (let at = start; at < end;) {
        const length = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8);
        if (length < 8 || at + length > end) throw new Error();
        if (type === 'avcC') return bytes.subarray(at + 8, at + length);
        const offset = ['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type) ? 8
          : type === 'stsd' ? 16 : type === 'avc1' || type === 'avc3' ? 86 : 0;
        const result = offset ? walk(at + offset, at + length, depth + 1) : undefined;
        if (result) return result;
        at += length;
      }
    };
    const config = walk(0, bytes.length);
    if (!config || config[0] !== 1 || !(config[5] & 31)) return { status: 'unavailable' };
    const sps = config.subarray(8, 8 + config.readUInt16BE(6));
    return { status: 'read', bytes: size, codec: `avc1.${config.subarray(1, 4).toString('hex')}`, ...readSps(sps) };
  } catch { return { status: 'unavailable' }; }
}

function readSps(nal: Buffer) {
  const data = [...nal].filter((value, index) => !(value === 3 && index >= 2 && nal[index - 1] === 0 && nal[index - 2] === 0));
  let bit = 8;
  const bits = (count: number) => {
    if (count > 32 || bit + count > data.length * 8) throw new Error();
    let value = 0;
    while (count--) { value = value * 2 + ((data[bit >>> 3] >>> (7 - (bit & 7))) & 1); bit++; }
    return value;
  };
  const ue = () => {
    let leading = 0;
    while (bits(1) === 0) if (++leading > 30) throw new Error();
    return 2 ** leading - 1 + bits(leading);
  };
  const se = () => { const value = ue(); return value % 2 ? (value + 1) / 2 : -value / 2; };
  const profile = bits(8);
  bits(8);
  const level = bits(8);
  ue();
  let chroma = 1, separate = 0, lumaDepth = 8, chromaDepth = 8;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    chroma = ue();
    if (chroma === 3) separate = bits(1);
    lumaDepth += ue(); chromaDepth += ue(); bits(1);
    if (bits(1)) for (let index = 0; index < (chroma === 3 ? 12 : 8); index++) {
      if (!bits(1)) continue;
      let last = 8, next = 8;
      for (let item = 0; item < (index < 6 ? 16 : 64); item++) {
        if (next) next = (last + se() + 256) % 256;
        last = next || last;
      }
    }
  }
  ue();
  const order = ue();
  if (order === 0) ue();
  else if (order === 1) {
    bits(1); se(); se();
    const count = ue();
    if (count > 256) throw new Error();
    for (let index = 0; index < count; index++) se();
  }
  const references = ue();
  bits(1);
  const codedWidth = (ue() + 1) * 16, mapHeight = (ue() + 1) * 16;
  const progressive = bits(1);
  if (!progressive) bits(1);
  bits(1);
  const crop = bits(1) ? [ue(), ue(), ue(), ue()] : [0, 0, 0, 0];
  const array = separate ? 0 : chroma;
  const cropX = array === 1 || array === 2 ? 2 : 1;
  const cropY = (array === 1 ? 2 : 1) * (2 - progressive);
  return { profile, level, chroma, lumaDepth, chromaDepth, references, codedWidth,
    codedHeight: mapHeight * (2 - progressive), width: codedWidth - (crop[0] + crop[1]) * cropX,
    height: mapHeight * (2 - progressive) - (crop[2] + crop[3]) * cropY };
}
