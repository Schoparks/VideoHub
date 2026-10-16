import { _electron as electron } from 'playwright';
import { copyFile, mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { choosePlayerQuality } from './player-test-actions.mjs';

// Copy encrypted credentials only when the user explicitly authorizes account reuse.
if (process.env.YINGJI_LIVE_TEST !== '1') {
  throw new Error('请设置 YINGJI_LIVE_TEST=1，以执行影视实际解码验证');
}
await mkdir('.tmp/pgc-playback-smoke', { recursive: true });
const profile = await mkdtemp(resolve('.tmp/pgc-playback-smoke/profile-'));
const accountDirectory = process.env.YINGJI_TEST_ACCOUNT_DIR;
const env = { ...process.env, YINGJI_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let app, page;
const errors = [];
const decoded = [];
try {
  if (accountDirectory) {
    await copyFile(join(accountDirectory, 'account.enc'), join(profile, 'account.enc'));
    // Windows OSCrypt binds safeStorage to the profile's encrypted key.
    await copyFile(join(accountDirectory, 'Local State'), join(profile, 'Local State'));
  }
  await writeFile(join(profile, 'library.json'), JSON.stringify({
    version: 1, library: [], history: [], queue: [], roots: [],
    preferences: { syncHistory: false },
  }));
  app = await electron.launch({
    ...(process.env.YINGJI_EXECUTABLE
      ? { executablePath: resolve(process.env.YINGJI_EXECUTABLE), args: [] }
      : { args: ['.'] }),
    cwd: resolve('.'), env, timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '首页' }).waitFor();
  const account = (await page.evaluate(() => window.hub.bootstrap())).account;
  assert.equal(account.web, !!accountDirectory, account.warning || '测试账号未连接网页登录');
  if (accountDirectory) {
    const legacy = await app.evaluate(async ({ app, safeStorage }) => {
      const fs = process.getBuiltinModule('node:fs/promises');
      const path = process.getBuiltinModule('node:path');
      const encrypted = await fs.readFile(path.join(app.getPath('userData'), 'account.enc'));
      const credentials = JSON.parse(safeStorage.decryptString(encrypted));
      const response = await fetch('https://api.bilibili.com/pgc/player/web/playurl?ep_id=3457304&qn=127&fnval=4048&fnver=0&fourk=1&high_quality=1', {
        headers: { Cookie: credentials.cookie, Referer: 'https://www.bilibili.com/' },
        signal: AbortSignal.timeout(15000),
      });
      const payload = await response.json();
      return { code: payload.code, drm: payload.result?.is_drm, drmType: payload.result?.drm_tech_type };
    });
    console.log('Legacy PGC flags:', JSON.stringify(legacy));
  }
  await app.evaluate(({ shell }) => {
    globalThis.pgcExternalCalls = 0;
    shell.openExternal = async () => { globalThis.pgcExternalCalls++; };
    globalThis.pgcResponses = [];
    const json = Response.prototype.json;
    Response.prototype.json = async function () {
      const payload = await json.call(this);
      if (this.url.includes('/pgc/player/')) {
        const data = payload.result?.video_info ?? payload.result;
        globalThis.pgcResponses.push({
          endpoint: new URL(this.url).pathname, code: payload.code,
          drm: data?.is_drm, drmType: data?.drm_tech_type,
          quality: data?.quality, preview: data?.is_preview, type: data?.type,
        });
      }
      return payload;
    };
  });
  const open = async url => {
    await page.getByRole('button', { name: '打开链接', exact: true }).click();
    await page.getByRole('textbox', { name: '视频地址' }).fill(url);
    await page.getByRole('button', { name: '打开视频', exact: true }).click();
  };
  const playing = async () => {
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video && video.videoWidth > 0 && video.currentTime > .5 && !video.paused;
    }, undefined, { timeout: 60000 });
    const state = await page.locator('video').evaluate(video => ({
      width: video.videoWidth, height: video.videoHeight,
      position: video.currentTime, duration: video.duration,
    }));
    decoded.push(state);
    return state;
  };

  // The first episode is public; subsequent episodes may only return an authorized preview.
  await open('https://www.bilibili.com/bangumi/play/ss210727');
  await playing();
  await page.getByRole('heading', { name: '黑袍纠察队 第一季', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.keyboard.press('Space');
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await page.locator('video').evaluate(async video => {
    video.currentTime = 18;
    await new Promise(done => video.addEventListener('seeked', done, { once: true }));
  });
  await choosePlayerQuality(page, 16);
  await page.waitForFunction(() => document.querySelector('video')?.paused
    && document.querySelector('video').readyState >= 2 && document.querySelector('video').currentTime >= 18);
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  await playing();
  await page.waitForFunction(() => document.querySelector('video')?.currentTime >= 18);
  await page.screenshot({ path: '.tmp/pgc-playback-smoke/black-boys-native.png' });
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('video'));
  const history = (await page.evaluate(() => window.hub.bootstrap())).history;
  assert.equal(history[0].part.episodeId, 3457304);
  assert.ok(history[0].position >= 18);

  await open('https://www.bilibili.com/bangumi/play/ep3457304');
  await playing();
  await page.waitForFunction(() => document.querySelector('video')?.currentTime >= 18);
  await page.keyboard.press('x');
  const picker = page.getByRole('dialog', { name: '选择分集' });
  await picker.waitFor();
  await picker.locator('button').filter({ hasText: '第 2 集' }).click();
  await playing();
  if (!accountDirectory) await page.locator('.playback-notice').filter({ hasText: '试看' }).waitFor();
  await page.screenshot({ path: '.tmp/pgc-playback-smoke/black-boys-preview.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.player:not(.controls-visible)'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('video'));
  const finalHistory = (await page.evaluate(() => window.hub.bootstrap())).history;
  assert.ok(finalHistory.some(entry => entry.part.episodeId === 3457305));
  assert.ok(finalHistory.find(entry => entry.part.episodeId === 3457304).position >= 18);

  // Inject only the encryption marker to force negotiation; the compatible MP4
  // and all of its media bytes still come from the real anonymous platform API.
  await app.evaluate(() => {
    const json = Response.prototype.json;
    globalThis.pgcCompatibleRequests = 0;
    Response.prototype.json = async function () {
      const payload = await json.call(this);
      if (payload.result?.video_info && new URL(this.url).searchParams.get('fnval') === '4048') {
        payload.result.video_info.is_drm = true;
      }
      const data = payload.result?.video_info ?? payload.result;
      if (data?.type === 'MP4' && data?.durl?.length) globalThis.pgcCompatibleRequests++;
      return payload;
    };
  });
  await open('https://www.bilibili.com/bangumi/play/ep3457304');
  await playing();
  const compatible = await app.evaluate(() => globalThis.pgcResponses.at(-1));
  assert.equal(compatible.type, 'MP4');
  assert.equal(await page.getByRole('button', { name: '清晰度', exact: true }).getAttribute('data-option-value'), String(compatible.quality));
  assert.equal(await app.evaluate(() => globalThis.pgcCompatibleRequests), 1);
  await page.screenshot({ path: '.tmp/pgc-playback-smoke/compatible-mp4.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.player:not(.controls-visible)'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('video'));
  assert.equal(await app.evaluate(() => globalThis.pgcExternalCalls), 0);
  assert.deepEqual(errors, []);
  const report = {
    result: 'passed', authenticated: !!accountDirectory,
    packaged: !!process.env.YINGJI_EXECUTABLE, decoded,
    responses: await app.evaluate(() => globalThis.pgcResponses),
    checks: [
      'real PGC v2 API, preload, session, gateway and decoder',
      'Black Boys first episode DASH native playback and 360P quality switch',
      'quality position retention, saved progress and resume',
      'second episode, episode switching and separate progress; preview verified when anonymous',
      'injected DRM marker negotiates real platform v2 MP4 and actually decodes',
      'keyboard back and zero external browser calls',
    ], errors,
  };
  const name = accountDirectory ? 'account-result.json' : 'result.json';
  await writeFile(join('.tmp/pgc-playback-smoke', name), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: '.tmp/pgc-playback-smoke/failure.png', timeout: 3000 }).catch(() => {});
    console.error(await page.locator('.player-error, .toast').allTextContents().catch(() => []));
  }
  if (app) console.error(await app.evaluate(() => globalThis.pgcResponses).catch(() => []));
  throw error;
} finally {
  try { await app?.close(); }
  finally {
    if (accountDirectory) {
      for (const name of ['account.enc', 'Local State']) {
        await unlink(join(profile, name)).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
  }
}
