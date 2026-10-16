import { describe, expect, it } from 'vitest';
import { buildDashManifest, playbackQualities } from '../electron/playback/dash';
import type { DashVideoTrack } from '../electron/playback/dash-video';

const track = (id: number, codecs: string) => ({
  id, codecs, width: id === 120 ? 3840 : 1920, height: id === 120 ? 2160 : 1080,
  bandwidth: 5000000, frameRate: '30', baseUrl: `https://media.example/${id}/${codecs}`,
  SegmentBase: { Initialization: '0-99', indexRange: '100-199' },
});
const avc = track(120, 'avc1.640033');
const hevc = track(120, 'hev1.1.6.L153.B0');
const av1 = track(120, 'av01.0.12M.08');

describe('platform codec selection within one Bilibili quality', () => {
  it('can select a positively supported HEVC track at the same 4K quality', () => {
    const support = (value: DashVideoTrack) => value.codecs.startsWith('hev1') ? 2 : 0;
    const data = { dash: { duration: 100, video: [avc, hevc, av1] } };
    const result = buildDashManifest(data.dash, url => url, 120, support);
    expect(result.quality).toBe(120);
    expect(result.manifest).toContain('hev1.1.6.L153.B0');
    expect(result.manifest).not.toContain('avc1');
    expect(playbackQualities(data, support)).toEqual([{ id: 120, label: '4K' }]);
  });

  it('keeps desktop selection and unsupported HEVC exclusion unchanged', () => {
    const dash = { duration: 100, video: [hevc, av1, avc] };
    expect(buildDashManifest(dash, url => url, 120).manifest).toContain('avc1.640033');
    expect(playbackQualities({ dash: { video: [hevc] } }, () => 0)).toEqual([]);
    expect(buildDashManifest(dash, url => url, 120).capabilities).toBeUndefined();
  });

  it('reports blocked alternatives at the selected quality without changing the selected manifest', () => {
    const support = Object.assign((value: DashVideoTrack) => value.codecs.startsWith('avc') ? 2 : 0, {
      inspect: (value: DashVideoTrack) => ({ mse: value.codecs.startsWith('avc'), decoder: 2 as const }),
    });
    const result = buildDashManifest({ duration: 100, video: [avc, hevc, track(80, av1.codecs)] }, url => url, 120, support);
    expect(result.codec).toBe('H.264');
    expect(result.quality).toBe(120);
    expect(result.manifest).not.toContain('hev1');
    expect(result.capabilities).toEqual([
      { codec: 'H.264', mse: true, decoder: 2 },
      { codec: 'HEVC', mse: false, decoder: 2 },
    ]);
  });

  it('does not lower 4K when only a lower quality has positive device support', () => {
    const dash = { duration: 100, video: [avc, track(80, 'avc1.640028')] };
    const result = buildDashManifest(dash, url => url, 120, value => value.id === 80 ? 2 : 0);
    expect(result.quality).toBe(120);
    expect(result.manifest).toContain('avc1.640033');
  });

  it('honors an explicit lower quality and prefers a supported codec over an unsupported one', () => {
    const dash = { duration: 100, video: [avc, track(80, 'avc1.640028'), track(80, 'av01.0.08M.08')] };
    const result = buildDashManifest(dash, url => url, 80, value => value.codecs.startsWith('av01') ? 1 : 0);
    expect(result.quality).toBe(80);
    expect(result.manifest).toContain('av01.0.08M.08');
    expect(result.manifest).not.toContain('avc1.640033');
  });
});
