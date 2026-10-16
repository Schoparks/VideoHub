import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { copyFile, mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

if (process.env.YINGJI_LIVE_TEST !== '1' || !process.env.YINGJI_TEST_ACCOUNT_DIR) {
  throw new Error('本探测需要明确授权后的账号目录及 YINGJI_LIVE_TEST=1');
}
const output = resolve('.tmp/protected-official');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
const env = { ...process.env, YINGJI_TEST_DATA: profile, YINGJI_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let app;
let report;
try {
  for (const name of ['account.enc', 'Local State']) {
    await copyFile(join(process.env.YINGJI_TEST_ACCOUNT_DIR, name), join(profile, name));
  }
  await writeFile(join(profile, 'library.json'), JSON.stringify({
    version: 1, library: [], history: [], queue: [], roots: [], preferences: { syncHistory: false },
  }));
  app = await electron.launch({ args: ['.'], cwd: resolve('.'), env });
  await app.firstWindow();
  await app.evaluate(async ({ app, BrowserWindow, safeStorage, session }) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const path = process.getBuiltinModule('node:path');
    const encrypted = await fs.readFile(path.join(app.getPath('userData'), 'account.enc'));
    const credentials = JSON.parse(safeStorage.decryptString(encrypted));
    if (!credentials.cookie) throw new Error('缺少已授权网页账号');
    const remote = session.fromPartition('protected-probe');
    globalThis.officialAudit = { show: 0, focus: 0, blockedHistory: 0, drmRequests: [] };
    for (const entry of credentials.cookie.split(';')) {
      const index = entry.indexOf('=');
      if (index < 1) continue;
      await remote.cookies.set({ url: 'https://www.bilibili.com', domain: '.bilibili.com',
        name: entry.slice(0, index).trim(), value: entry.slice(index + 1).trim(), secure: true });
    }
    remote.setPermissionRequestHandler((web, permission, callback) => {
      callback(permission === 'mediaKeySystem' && new URL(web.getURL()).hostname.endsWith('.bilibili.com'));
    });
    remote.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const history = /heartbeat|history\/report/.test(url.pathname);
      if (history) globalThis.officialAudit.blockedHistory++;
      if (/drm|license|playurl|spc|ckc/.test(url.pathname)) {
        globalThis.officialAudit.drmRequests.push({ host: url.hostname, path: url.pathname });
      }
      callback({ cancel: history });
    });
    const window = new BrowserWindow({ width: 1440, height: 950, show: false, skipTaskbar: true,
      webPreferences: { session: remote, sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false } });
    window.webContents.setAudioMuted(true);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.on('show', () => globalThis.officialAudit.show++);
    window.on('focus', () => globalThis.officialAudit.focus++);
    await window.loadURL('https://www.bilibili.com/bangumi/play/ep278480?theme=movie');
  });
  const page = app.windows().find(page => page.url().includes('/bangumi/play/ep278480'));
  assert.ok(page);
  await page.waitForTimeout(15000);
  const initial = await page.evaluate(() => ({
    videos: [...document.querySelectorAll('video')].map(video => ({
      width: video.videoWidth, duration: video.duration, paused: video.paused, time: video.currentTime,
    })), eme: !!navigator.requestMediaKeySystemAccess,
  }));
  await page.evaluate(() => { for (const video of document.querySelectorAll('video')) { video.muted = true; void video.play().catch(() => {}); } });
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some(video => video.videoWidth > 0 && video.currentTime > 1),
    undefined, { timeout: 30000 }).catch(() => {});
  report = await page.evaluate(() => ({
    videos: [...document.querySelectorAll('video')].map(video => ({
      width: video.videoWidth, height: video.videoHeight, duration: video.duration,
      paused: video.paused, time: video.currentTime, error: video.error?.code, emeAttached: !!video.mediaKeys,
    })), playerErrors: [...document.querySelectorAll('[class*="error-text"], [class*="error-message"]')].map(el => el.textContent),
  }));
  report.playbackFlags = await page.evaluate(() => {
    const found = [];
    const seen = new WeakSet();
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 16 || seen.has(value)) return;
      seen.add(value);
      if (value.dash || value.durl) found.push({ drm: value.is_drm, drmType: value.drm_tech_type,
        quality: value.quality, preview: value.is_preview, dash: !!value.dash,
        trackFlags: value.dash?.video?.slice(0, 2).map(track => ({ drm: track.is_drm, drmType: track.drm_tech_type })) });
      for (const child of Object.values(value)) visit(child, depth + 1);
    };
    const next = document.querySelector('#__NEXT_DATA__')?.textContent;
    if (next) visit(JSON.parse(next));
    visit(window.__playinfo__);
    visit(window.__INITIAL_STATE__);
    if (typeof playurlSSRData === 'object') visit(playurlSSRData);
    return found;
  });
  report.globalNames = await page.evaluate(() => Object.keys(window).filter(key => /play|initial|state|prefetch/i.test(key)));
  report.nativeContainer = await app.evaluate(async ({ app, safeStorage }) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const path = process.getBuiltinModule('node:path');
    const encrypted = await fs.readFile(path.join(app.getPath('userData'), 'account.enc'));
    const credentials = JSON.parse(safeStorage.decryptString(encrypted));
    const response = await fetch('https://api.bilibili.com/pgc/player/web/v2/playurl?ep_id=278480&qn=127&fnval=4048&fnver=0&fourk=1&high_quality=1', {
      headers: { Cookie: credentials.cookie, Referer: 'https://www.bilibili.com/' }, signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    const video = payload.result.video_info;
    const tracks = [video.dash.video.find(track => /^avc/.test(track.codecs)), video.dash.audio[0]];
    return await Promise.all(tracks.map(async track => {
      const segment = track.segment_base || track.SegmentBase;
      const range = segment.initialization || segment.Initialization;
      const media = await fetch(track.base_url || track.baseUrl, {
        headers: { Referer: 'https://www.bilibili.com/', Range: `bytes=${range}` }, signal: AbortSignal.timeout(15000),
      });
      const buffer = Buffer.from(await media.arrayBuffer());
      return { drm: video.is_drm, drmType: video.drm_tech_type, codec: track.codecs, status: media.status,
        bytes: buffer.length, encryptedEntry: buffer.includes(Buffer.from('encv')) || buffer.includes(Buffer.from('enca')),
        protectionBox: buffer.includes(Buffer.from('sinf')) || buffer.includes(Buffer.from('tenc')),
        sampleEntry: buffer.includes(Buffer.from('avc1')) ? 'avc1' : buffer.includes(Buffer.from('mp4a')) ? 'mp4a' : 'unknown' };
    }));
  });
  report.initial = initial;
  report.audit = await app.evaluate(({ BrowserWindow }) => ({
    ...globalThis.officialAudit,
    windows: BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), focused: window.isFocused(), muted: window.webContents.isAudioMuted() })),
  }));
  assert.ok(report.audit.windows.every(window => !window.visible && !window.focused && window.muted));
  assert.equal(report.audit.show + report.audit.focus, 0);
} finally {
  try { await app?.close(); }
  finally {
    for (const name of ['account.enc', 'account.enc.tmp', 'Local State']) {
      await unlink(join(profile, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
report.encryptedCopiesRemoved = true;
await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
