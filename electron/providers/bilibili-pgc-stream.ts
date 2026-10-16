import { mp4Protection } from '../playback/mp4-protection';
import { playableVideoTracks } from '../playback/dash';
import { USER_AGENT } from '../protocol/http';

const encrypted = (track: any) => [true, 1, '1', 'true'].includes(track.is_drm) || Number(track.drm_tech_type) > 0;
const mediaHost = (host: string) => ['bilivideo.com', 'bilivideo.cn', 'akamaized.net']
  .some(domain => host === domain || host.endsWith(`.${domain}`));

async function clearInitialization(track: any, fetcher: typeof fetch) {
  if (encrypted(track)) return false;
  const segment = track.SegmentBase || track.segment_base;
  const range = segment?.Initialization || segment?.initialization;
  const match = /^0-(\d+)$/.exec(range || '');
  if (!match || Number(match[1]) >= 65536) return false;
  let url: URL;
  try { url = new URL(track.baseUrl || track.base_url); } catch { return false; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !mediaHost(url.hostname)) return false;
  try {
    const response = await fetcher(url, {
      headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': USER_AGENT, Range: `bytes=${range}` },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    const expected = Number(match[1]) + 1;
    if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes 0-${match[1]}/`)) {
      await response.body?.cancel();
      return false;
    }
    const reader = response.body?.getReader();
    if (!reader) return false;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expected) { await reader.cancel(); return false; }
      chunks.push(value);
    }
    return size === expected && mp4Protection(Buffer.concat(chunks)) === 'clear';
  } catch { return false; }
}

/** A title-level DRM flag alone is ambiguous. Require verified clear sample entries. */
export async function verifiedClearPgcDash(dash: any, fetcher: typeof fetch = fetch) {
  const videos = playableVideoTracks(dash);
  const audio = dash.audio || [];
  const result = new Map<any, boolean>();
  const tracks = [...videos, ...audio];
  if (tracks.length > 64) return undefined;
  // Small, bounded initialization reads; no cookies, tokens, media keys or full files.
  for (let index = 0; index < tracks.length; index += 3) {
    await Promise.all(tracks.slice(index, index + 3).map(async track => {
      result.set(track, await clearInitialization(track, fetcher));
    }));
  }
  const clearVideo = videos.filter(track => result.get(track));
  const clearAudio = audio.filter((track: any) => result.get(track));
  if (!clearVideo.length || audio.length && !clearAudio.length) return undefined;
  return { ...dash, video: clearVideo, audio: clearAudio };
}
