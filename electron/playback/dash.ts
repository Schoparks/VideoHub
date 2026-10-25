import { playableVideoTracks, selectVideoTrack, videoCapabilities, type VideoSupport } from './dash-video';
import { bilibiliResolution, selectBilibiliQuality } from '../../src/shared/bilibili-quality';
export { playableVideoTracks } from './dash-video';
const xml = (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function qualityLabel(data: any, quality: number) {
  if (quality === 80) return '1080P';
  const format = data.support_formats?.find((f: any) => Number(f.quality) === quality);
  const labels: Record<number, string> = { 6: '240P', 16: '360P', 32: '480P', 64: '720P', 74: '720P 60帧', 80: '1080P', 112: '1080P 高码率', 116: '1080P 60帧', 120: '4K', 125: 'HDR', 126: '杜比视界', 127: '8K' };
  return format?.new_description || format?.display_desc || labels[quality] || String(quality);
}
export function playbackQualities(data: any, support?: VideoSupport) {
  const ids = data.dash ? playableVideoTracks(data.dash, support).map(v => Number(v.id)) : data.quality ? [Number(data.quality)] : [];
  return [...new Set<number>(ids)].sort((a, b) => bilibiliResolution(b) - bilibiliResolution(a)).map(id => ({ id, label: qualityLabel(data, id) }));
}
export function buildDashManifest(dash: any, register: (url: string, backups?: string[]) => string, quality: number, support?: VideoSupport) {
  const videos = playableVideoTracks(dash, support);
  if (!videos.length) throw new Error('此视频没有兼容的 H.264 / AV1 视频轨，请使用官方播放器');
  const selectedQuality = selectBilibiliQuality(videos.map(v => Number(v.id)), quality);
  const video = selectVideoTrack(videos.filter((v: any) => Number(v.id) === selectedQuality), support);
  const audio = [...(dash.audio || [])].sort((a, b) => b.bandwidth - a.bandwidth)[0];
  function adaptation(track: any, kind: 'video' | 'audio') {
    const segment = track.SegmentBase || track.segment_base;
    const init = segment?.Initialization || segment?.initialization;
    const index = segment?.indexRange || segment?.index_range;
    if (!init || !index) throw new Error('B 站返回的 DASH 索引不完整');
    const backup = track.backupUrl || track.backup_url;
    const address = register(track.baseUrl || track.base_url,
      Array.isArray(backup) ? backup.filter((url: unknown): url is string => typeof url === 'string').slice(0, 4) : undefined);
    return `<AdaptationSet contentType="${kind}" mimeType="${kind}/mp4" segmentAlignment="true"><Representation id="${kind}-${track.id}" bandwidth="${Number(track.bandwidth)}" codecs="${xml(track.codecs)}"${kind === 'video' ? ` width="${track.width}" height="${track.height}"` : ` audioSamplingRate="${track.sampleRate || 48000}"`}><BaseURL>${xml(address)}</BaseURL><SegmentBase indexRange="${xml(index)}"><Initialization range="${xml(init)}"/></SegmentBase></Representation></AdaptationSet>`;
  }
  const codec = /^avc/i.test(video.codecs) ? 'H.264' as const
    : /^av01/i.test(video.codecs) ? 'AV1' as const : 'HEVC' as const;
  const capabilities = videoCapabilities(dash.video, video, support);
  return { quality: selectedQuality, codec, capabilities, manifest: `<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" minBufferTime="PT1.5S" mediaPresentationDuration="PT${Number(dash.duration)}S"><Period start="PT0S">${adaptation(video, 'video')}${audio ? adaptation(audio, 'audio') : ''}</Period></MPD>` };
}
