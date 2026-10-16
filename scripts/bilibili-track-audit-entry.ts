import { app, safeStorage } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Vault } from '../electron/accounts/vault';
import { BiliHttp } from '../electron/protocol/http';
import { BilibiliSigning } from '../electron/protocol/bilibili-signing';
import { auditAvc } from './bilibili-avc-audit';

// No BrowserWindow, media playback, token refresh, history report or credential output.
const profile = process.env.YINGJI_AUDIT_PROFILE;
const bvid = process.env.YINGJI_ANDROID_BVID || '';
if (process.env.YINGJI_LIVE_TEST !== '1' || !profile || !/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) {
  app.exit(1);
} else {
  app.setPath('userData', profile);
  void app.whenReady().then(async () => {
    const report: Record<string, unknown> = { bvid, status: 'failed' };
    const vault = new Vault(profile, {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: value => safeStorage.encryptString(value),
      decrypt: value => safeStorage.decryptString(value),
    });
    try {
      await vault.init();
      const authenticated = !!vault.value.cookie;
      if (process.env.YINGJI_AUDIT_ACCOUNT === '1' && !authenticated) {
        throw new Error('isolated account unavailable');
      }
      report.authenticated = authenticated;
      const http = new BiliHttp(() => vault.value.cookie || '');
      const signing = new BilibiliSigning(http);
      const detail = await http.get('https://api.bilibili.com/x/web-interface/view', { bvid });
      report.cid = detail.cid;
      report.dimensions = { width: detail.dimension?.width, height: detail.dimension?.height };
      const responses = [];
      for (const qn of [120, 80]) {
        const data = await signing.get('/x/player/wbi/playurl', {
          cid: detail.cid, bvid, avid: detail.aid, qn, fnval: 4048, fnver: 0, fourk: 1, high_quality: 1,
        });
        const selected = (data.dash?.video || []).find((track: any) => track.id === qn && /^avc1\./.test(track.codecs));
        const initialization = selected ? await auditAvc(selected) : undefined;
        responses.push({ requested: qn, quality: data.quality, initialization,
          formats: (data.support_formats || []).map((format: any) => ({
            quality: format.quality, codecs: format.codecs,
          })),
          video: (data.dash?.video || []).map((track: any) => ({
            id: track.id, codecs: track.codecs, width: track.width, height: track.height,
            frameRate: track.frameRate || track.frame_rate, bandwidth: track.bandwidth,
          })),
          audio: (data.dash?.audio || []).map((track: any) => ({ id: track.id, codecs: track.codecs,
            bandwidth: track.bandwidth, sampleRate: track.sampleRate || track.sample_rate })),
        });
      }
      report.responses = responses;
      report.status = 'complete';
    } catch { report.failure = '无法读取指定视频的轨道信息；未记录原始接口错误。'; }
    finally {
      vault.value = {};
      await writeFile(join(profile, 'track-report.json'), JSON.stringify(report, null, 2));
      app.exit(report.status === 'complete' ? 0 : 1);
    }
  });
}
