import type { DashVideoTrack, VideoSupport } from '../../electron/playback/dash-video';
import { native } from './native';

type Capability = { mse: boolean; decoder: 0 | 1 | 2 };
const cache = new Map<string, Capability>();

/** A native decoder alone is insufficient: this WebView must also accept its MSE codec. */
export const androidVideoSupport: VideoSupport = Object.assign((track: DashVideoTrack) => {
  const capability = inspect(track);
  return capability.mse ? capability.decoder : 0;
}, { inspect });

function inspect(track: DashVideoTrack): Capability {
  const fields = [track.codecs, track.width, track.height, track.frameRate || track.frame_rate || 0];
  const key = JSON.stringify(fields);
  if (cache.has(key)) return cache.get(key)!;
  const capability: Capability = { mse: false, decoder: 0 };
  try {
    capability.mse = typeof MediaSource !== 'undefined'
      && MediaSource.isTypeSupported(`video/mp4; codecs="${track.codecs}"`);
  } catch { /* Keep the independent native declaration when this query is unavailable. */ }
  try {
    const score = native.videoSupport(JSON.stringify({
      codec: track.codecs, width: track.width, height: track.height,
      frameRate: String(fields[3]),
    }));
    if (score === 1 || score === 2) capability.decoder = score;
  } catch { /* Capability uncertainty retains the existing track/error path. */ }
  if (cache.size >= 128) cache.clear();
  cache.set(key, capability);
  return capability;
}
