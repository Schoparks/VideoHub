import assert from 'node:assert/strict';
import { choosePlayerQuality, choosePlayerRate, revealPlayerControls } from './player-test-actions.mjs';
import { holdPlayerMedia } from './player-test-network.mjs';
import { checkPlayerSuspend } from './player-test-suspend.mjs';
import { checkPlayerErrorRecovery } from './player-test-error.mjs';
import { checkPlayerCompletion } from './player-test-completion.mjs';
import { checkFollowingLive } from './player-test-live.mjs';
import { checkHiddenWindowState } from './player-test-window.mjs';
import { checkPlayerBuffering } from './player-test-buffering.mjs';
import { checkLoadingRestart } from './player-test-loading-restart.mjs';
import { checkPlayerPreviewOwnership } from './player-test-preview-ownership.mjs';
import { _electron as electron } from 'playwright';
import { copyFile, mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

if (process.env.YINGJI_LIVE_TEST !== '1') throw new Error('请明确启用 YINGJI_LIVE_TEST=1');
const accountDirectory = process.env.YINGJI_TEST_ACCOUNT_DIR;
const executablePath = process.env.YINGJI_EXECUTABLE;
const output = resolve('.tmp/movie-account-hidden');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
const env = { ...process.env, YINGJI_TEST_DATA: profile, YINGJI_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let app;
let mediaGate;
const report = { packaged: !!executablePath, authenticated: false, decoded: false, responses: [], errors: [] };
const resultName = executablePath ? 'packaged-result.json' : accountDirectory ? 'account-result.json' : 'startup-result.json';
const resultPath = join(output, resultName);
await writeFile(resultPath, JSON.stringify(report, null, 2));
try {
  // Authorization must precede supplying this directory. Only encrypted files are copied.
  if (accountDirectory) {
    for (const name of ['account.enc', 'Local State']) {
      await copyFile(join(accountDirectory, name), join(profile, name));
    }
  }
  await writeFile(join(profile, 'library.json'), JSON.stringify({
    version: 1, library: [], history: [], queue: [], roots: [],
    preferences: { syncHistory: false, tvMode: false, autoNext: false },
  }));
  app = await electron.launch({ executablePath, args: executablePath ? [] : ['.'], cwd: resolve('.'), env, timeout: 30000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(25000);
  page.on('pageerror', () => report.errors.push('renderer exception'));
  const initial = await app.evaluate(({ BrowserWindow, shell }) => {
    const windows = BrowserWindow.getAllWindows();
    globalThis.movieAudit = { show: 0, focus: 0, external: 0, historyWrites: 0, responses: [] };
    for (const window of windows) {
      window.on('show', () => globalThis.movieAudit.show++);
      window.on('focus', () => globalThis.movieAudit.focus++);
    }
    shell.openExternal = async () => { globalThis.movieAudit.external++; };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('/history/report') || String(url).includes('/history/heartbeat')) {
        globalThis.movieAudit.historyWrites++;
      }
      return originalFetch(url, options);
    };
    const json = Response.prototype.json;
    Response.prototype.json = async function () {
      const payload = await json.call(this);
      if (this.url.includes('/user/following')) {
        const rooms = payload.data?.rooms || payload.data?.list || [];
        globalThis.movieAudit.followingFields = rooms.slice(0, 2).map(room => ({
          keys: Object.keys(room),
          artworkTypes: Object.fromEntries(Object.entries(room)
            .filter(([key]) => /cover|frame|pic|image/i.test(key))
            .map(([key, value]) => [key, { type: typeof value, present: !!value }])),
        }));
      }
      if (this.url.includes('/pgc/player/')) {
        const data = payload.result?.video_info ?? payload.result ?? payload.data;
        globalThis.movieAudit.responses.push({
          endpoint: new URL(this.url).pathname,
          fnval: new URL(this.url).searchParams.get('fnval'), code: payload.code,
          drm: data?.is_drm, drmType: data?.drm_tech_type,
          quality: data?.quality, preview: data?.is_preview, type: data?.type,
        });
      }
      return payload;
    };
    return windows.map(window => ({ visible: window.isVisible(), focused: window.isFocused(), muted: window.webContents.isAudioMuted() }));
  });
  assert.ok(initial.length === 1 && initial.every(window => !window.visible && !window.focused && window.muted));
  await page.waitForFunction(() => !!window.hub);
  const status = await page.evaluate(async () => {
    const boot = await window.hub.bootstrap();
    return { web: boot.account.web, encrypted: boot.account.storage === 'encrypted', syncHistory: boot.preferences.syncHistory };
  });
  assert.equal(status.web, !!accountDirectory, '隔离副本无法连接网页登录');
  assert.equal(status.syncHistory, false);
  report.authenticated = status.web;
  report.hiddenStartup = initial;
  const iconRoot = await app.evaluate(({ app }) => ({ root: app.getAppPath(), packaged: app.isPackaged }));
  report.appIcon = await app.evaluate(({ nativeImage }, path) => {
    const image = nativeImage.createFromPath(path);
    return { empty: image.isEmpty(), ...image.getSize() };
  }, join(iconRoot.root, iconRoot.packaged ? 'dist' : 'public', 'app-icon-512.png'));
  assert.deepEqual(report.appIcon, { empty: false, width: 512, height: 512 });
  if (process.env.YINGJI_HIDDEN_STARTUP_ONLY !== '1') {
    const following = await page.evaluate(async () => {
      try {
        const result = await window.hub.browse({ kind: 'followingLive' });
        const items = result.items;
        const cover = items.find(item => item.cover)?.cover;
        let image = null;
        if (cover) {
          image = await new Promise(done => {
            const img = document.createElement('img');
            img.onload = () => done({ loaded: true, width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => done({ loaded: false });
            img.src = `yingji://app/image?url=${encodeURIComponent(cover)}`;
          });
        }
        return { count: items.length, withCover: items.filter(item => item.cover).length, image };
      } catch { return { failed: true }; }
    });
    report.followingCovers = following;
    if (following.withCover) {
      await page.getByRole('button', { name: '关注直播', exact: true }).evaluate(button => button.click());
      await page.waitForFunction(() => document.querySelector('.media-card .cover img'));
      await page.locator('.media-card .cover img').first().evaluate(img => { img.loading = 'eager'; });
      await page.waitForFunction(() => {
        const image = document.querySelector('.media-card .cover img');
        return image?.complete && image.naturalWidth > 0;
      });
      report.followingCovers.cardImage = await page.locator('.media-card .cover img').first()
        .evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight,
          thumbnail: decodeURIComponent(img.currentSrc).includes('@960w_960h.webp') }));
      if (report.followingCovers.cardImage.thumbnail) {
        assert.ok(report.followingCovers.cardImage.width <= 960 && report.followingCovers.cardImage.height <= 960);
      }
    }
    if (process.env.YINGJI_TEST_LIVE_ROOM === '1') report.live = await checkFollowingLive(page);
    const search = await page.evaluate(async () => {
      const result = await window.hub.browse({ kind: 'search', keyword: '幸福终点站', searchType: 'media_ft' });
      return result.items.find(item => item.title === '幸福终点站');
    });
    assert.ok(search?.kind === 'season', '搜索结果未找到指定电影');
    report.searchIdentity = { kind: search.kind, seasonId: search.seasonId, episodeId: search.episodeId };
    await page.getByRole('button', { name: '手柄屏幕键盘', exact: true }).evaluate(button => button.click());
    for (const [spelling, word] of [['xingfu', '幸福'], ['zhongdian', '终点'], ['zhan', '站']]) {
      for (const letter of spelling) {
        await page.locator('.keyboard-keys').getByRole('button', { name: letter, exact: true })
          .evaluate(button => button.click());
      }
      const candidate = page.locator('.candidate-row').getByRole('button', { name: word, exact: true });
      await candidate.waitFor();
      await candidate.evaluate(button => button.click());
    }
    assert.equal(await page.getByRole('textbox', { name: '搜索关键词', exact: true }).inputValue(), '幸福终点站');
    report.offlineKeyboard = true;
    await page.locator('.search-dialog form').evaluate(form => form.requestSubmit());
    const movie = page.getByRole('button', { name: '播放 幸福终点站', exact: true });
    await movie.waitFor();
    mediaGate = await holdPlayerMedia(page);
    await movie.evaluate(button => button.click());
    await page.getByRole('button', { name: '播放速度', exact: true }).waitFor();
    for (let attempt = 0; !mediaGate.count() && attempt < 100; attempt++) await page.waitForTimeout(20);
    assert.ok(mediaGate.count() > 0, '没有观察到被延迟的本机媒体请求');
    const readyBeforeRate = await page.locator('video').evaluate(video => video.readyState);
    assert.equal(readyBeforeRate, 0);
    await choosePlayerRate(page, 2);
    await page.getByRole('button', { name: '暂停', exact: true }).evaluate(button => button.click());
    await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
    const blockedMediaRequests = mediaGate.count();
    await mediaGate.release();
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video?.videoWidth === 1920 && video.readyState >= 2 && video.paused;
    }, undefined, { timeout: 60000 });
    const loadingPausedPosition = await page.locator('video').evaluate(video => video.currentTime);
    await page.waitForTimeout(600);
    report.loadingPause = await page.locator('video').evaluate(video => ({
      width: video.videoWidth, height: video.videoHeight, position: video.currentTime, paused: video.paused, rate: video.playbackRate,
    }));
    assert.equal(report.loadingPause.paused, true);
    assert.equal(report.loadingPause.rate, 2);
    assert.ok(Math.abs(report.loadingPause.position - loadingPausedPosition) < .05);
    await page.getByRole('button', { name: '继续播放', exact: true }).evaluate(button => button.click());
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video && video.videoWidth > 0 && video.currentTime > .5 && !video.paused
        || !!document.querySelector('.player-error, .toast:not(:empty)');
    }, undefined, { timeout: 60000 });
    report.media = await page.evaluate(() => {
      const video = document.querySelector('video');
      return video ? { width: video.videoWidth, height: video.videoHeight, position: video.currentTime, duration: video.duration } : null;
    });
    report.decoded = !!report.media?.width && report.media.position > .5;
    report.loadingRate = { readyBeforeRate, blockedMediaRequests,
      actual: await page.locator('video').evaluate(video => video.playbackRate) };
    assert.equal(report.loadingRate.actual, 2);
    report.feedback = await page.locator('.player-error, .toast').allTextContents();
    if (report.decoded) {
      report.windowState = await checkHiddenWindowState(page);
      report.buffering = await checkPlayerBuffering(page);
      report.previewOwnership = await checkPlayerPreviewOwnership(page);
      report.suspend = await checkPlayerSuspend(app, page);
      report.errorRecovery = await checkPlayerErrorRecovery(page);
      report.errorQualityRecovery = await checkPlayerErrorRecovery(page, 64);
      await choosePlayerQuality(page, 80);
      await page.waitForFunction(() => document.querySelector('video')?.videoWidth === 1920
        && !document.querySelector('video').paused, undefined, { timeout: 60000 });
      report.completion = await checkPlayerCompletion(app, page);
      await revealPlayerControls(page);
      await page.getByRole('button', { name: '暂停', exact: true }).evaluate(button => button.click());
      await page.waitForFunction(() => document.querySelector('video')?.paused);
      await page.locator('video').evaluate(video => { video.currentTime = 18; });
      await page.getByRole('button', { name: '播放设置', exact: true }).evaluate(button => button.click());
      const theme = page.getByRole('switch', { name: '深色外观', exact: true });
      await theme.focus();
      await page.keyboard.press('Space');
      assert.equal(await theme.isChecked(), true);
      assert.equal(await page.locator('video').evaluate(video => video.paused), true);
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).focus();
      await page.keyboard.press('Space');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await choosePlayerQuality(page, 64, 'space');
      report.keyboardControls = { settingsSpace: true, qualitySpace: true };
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return video?.videoWidth === 1280 && video.readyState >= 2 && video.currentTime >= 18 && video.paused;
      }, undefined, { timeout: 60000 });
      const pausedPosition = await page.locator('video').evaluate(video => video.currentTime);
      await page.waitForTimeout(800);
      assert.equal(await page.locator('video').evaluate(video => video.paused), true);
      assert.ok(Math.abs(await page.locator('video').evaluate(video => video.currentTime) - pausedPosition) < .05);
      report.pausedQualitySwitch = await page.locator('video').evaluate(video => ({
        width: video.videoWidth, height: video.videoHeight, position: video.currentTime, paused: video.paused, rate: video.playbackRate,
      }));
      assert.equal(report.pausedQualitySwitch.rate, 2);
      await page.getByRole('button', { name: '继续播放', exact: true }).evaluate(button => button.click());
      await page.waitForFunction(() => !document.querySelector('video').paused && document.querySelector('video').currentTime > 18.1);
      report.qualitySwitch = await page.locator('video').evaluate(video => ({
        width: video.videoWidth, height: video.videoHeight, position: video.currentTime,
      }));
      await page.getByRole('button', { name: '退出播放', exact: true }).evaluate(button => button.click());
      await page.waitForFunction(() => !document.querySelector('video'));
      const saved = await page.evaluate(async () => {
        const history = (await window.hub.bootstrap()).history;
        const entry = history.find(entry => entry.part?.episodeId === 278480);
        return entry && { episodeId: entry.part.episodeId, position: entry.position };
      });
      assert.ok(saved?.position >= 18);
      report.saved = saved;
      await movie.evaluate(button => button.click());
      await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0
        && document.querySelector('video').currentTime >= 18, undefined, { timeout: 60000 });
      report.resumed = true;
      await page.getByRole('button', { name: '退出播放', exact: true }).evaluate(button => button.click());
      await page.waitForFunction(() => !document.querySelector('video'));
      report.loadingRestart = await checkLoadingRestart(page, () => movie.evaluate(button => button.click()));
    }
    // Explicit episode independently checks the exact user-supplied reference.
    const exact = await page.evaluate(async () => {
      const item = await window.hub.openUrl('https://www.bilibili.com/bangumi/play/ep278480?theme=movie');
      try {
        const source = await window.hub.resolve(item);
        const result = { resolved: true, episodeId: source.part?.episodeId, quality: source.quality, notice: source.notice };
        await window.hub.release(source.sessionId);
        return result;
      } catch (error) { return { resolved: false, episodeId: item.episodeId, error: error.message }; }
    });
    report.exactEpisode = exact;
  }
  const audit = await app.evaluate(({ BrowserWindow }) => ({
    ...globalThis.movieAudit,
    windows: BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), focused: window.isFocused(), muted: window.webContents.isAudioMuted() })),
  }));
  report.responses = audit.responses;
  delete audit.responses;
  report.audit = audit;
  assert.ok(audit.windows.every(window => !window.visible && !window.focused && window.muted));
  assert.equal(audit.show + audit.focus + audit.external + audit.historyWrites, 0);
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failed = true;
  throw error;
} finally {
  try { await mediaGate?.release(); }
  finally {
    try { await app?.close(); }
    finally {
      // Includes temporary atomic-write copies in case an isolated token refresh failed.
      for (const name of ['account.enc', 'account.enc.tmp', 'Local State']) {
        await unlink(join(profile, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      report.encryptedCopiesRemoved = true;
      await writeFile(resultPath, JSON.stringify(report, null, 2));
    }
  }
}
console.log(JSON.stringify(report, null, 2));
