import type { VideoCapability, VideoCodec } from '../../src/shared/video-capability';

export interface DashVideoTrack {
  id: number;
  codecs: string;
  width: number;
  height: number;
  bandwidth: number;
  frameRate?: string | number;
  frame_rate?: string | number;
}

/** Platform capability scoring only; quality selection stays in the manifest builder. */
export type VideoSupport = ((track: DashVideoTrack) => number) & {
  inspect?: (track: DashVideoTrack) => Omit<VideoCapability, 'codec'>;
};

export function videoCapabilities(tracks: DashVideoTrack[], selected: DashVideoTrack, support?: VideoSupport) {
  if (!support?.inspect) return undefined;
  const facts: VideoCapability[] = [];
  for (const [codec, pattern] of [
    ['H.264', /^avc[13]\./i], ['HEVC', /^(?:hev1|hvc1)\./i], ['AV1', /^av01\./i],
  ] as [VideoCodec, RegExp][]) {
    const candidates = tracks.filter(track => Number(track.id) === Number(selected.id) && pattern.test(track.codecs));
    // Describe the exact selected track; alternatives use their best candidate at this quality.
    const track = candidates.includes(selected) ? selected : selectVideoTrack(candidates, support);
    if (track) facts.push({ codec, ...support.inspect(track) });
  }
  return facts;
}

export function playableVideoTracks(dash: any, support?: VideoSupport): any[] {
  return (dash.video || []).filter((track: DashVideoTrack) => Number(track.id) > 0
    && (/^(?:avc[13]|av01)\./i.test(String(track.codecs))
      || !!support && /^(?:hev1|hvc1)\./i.test(String(track.codecs)) && support(track) > 0));
}

export function selectVideoTrack(tracks: any[], support?: VideoSupport) {
  // Never compare scores across qualities or change the requested part.
  const scores = new Map(tracks.map(track => [track, support?.(track) || 0]));
  return [...tracks].sort((a, b) => (scores.get(b)! - scores.get(a)!)
    || Number(/^avc/i.test(b.codecs)) - Number(/^avc/i.test(a.codecs))
    || Number(b.bandwidth) - Number(a.bandwidth))[0];
}
