import { expect, it } from 'vitest';
import { buildDashManifest } from '../electron/playback/dash';

it.each(['backupUrl', 'backup_url'])('keeps platform %s mirrors with the same selected audio/video track', key => {
  const registrations: { primary: string; backups?: string[] }[] = [];
  const track = (id: number, codec: string) => ({
    id, codecs: codec, bandwidth: 100000, width: 1920, height: 1080,
    baseUrl: `https://primary.example/${id}.m4s`,
    [key]: [`https://backup.example/${id}.m4s`],
    SegmentBase: { indexRange: '100-200', Initialization: '0-99' },
  });
  const result = buildDashManifest({ duration: 100, video: [track(80, 'avc1.640028')],
    audio: [track(30280, 'mp4a.40.2')] }, (primary, backups) => {
    registrations.push({ primary, backups });
    return `https://local.example/opaque/${registrations.length}`;
  }, 80);
  expect(result.quality).toBe(80);
  expect(registrations).toEqual([
    { primary: 'https://primary.example/80.m4s', backups: ['https://backup.example/80.m4s'] },
    { primary: 'https://primary.example/30280.m4s', backups: ['https://backup.example/30280.m4s'] },
  ]);
  expect(result.manifest).toContain('https://local.example/opaque/1');
  expect(result.manifest).not.toContain('backup.example');
});
