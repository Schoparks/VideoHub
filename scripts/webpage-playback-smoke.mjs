import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { _electron as electron } from 'playwright';
import { createWebpageFixture } from './webpage-media-fixture.mjs';
import { revealPlayerControls } from './player-test-actions.mjs';

// Real local webpages and decoded media, no account, system input or visible window.
const output = resolve('.tmp/webpage-playback');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
await writeFile(join(profile, 'library.json'), JSON.stringify({ version: 1, library: [], history: [], queue: [], roots: [],
  preferences: { syncHistory: false, tvMode: false, autoNext: false } }));
const env = { ...process.env, YINGJI_TEST_DATA: profile, YINGJI_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const executablePath = env.YINGJI_EXECUTABLE;
let app, fixture;
const report = { packaged: !!executablePath, checks: [], errors: [], completed: false };
const resultPath = join(output, executablePath ? 'packaged-result.json' : 'result.json');
await writeFile(resultPath, JSON.stringify(report, null, 2));
try {
  app = await electron.launch({ executablePath, args: executablePath ? [] : ['.'], cwd: resolve('.'), env, timeout: 30000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
  await app.evaluate(({ app, BrowserWindow, shell }) => {
    globalThis.webpageAudit = { show: 0, focus: 0, external: 0, probes: 0, unsafe: 0 };
    const watch = (window, probe = false) => {
      window.on('show', () => globalThis.webpageAudit.show++);
      window.on('focus', () => globalThis.webpageAudit.focus++);
      if (probe) globalThis.webpageAudit.probes++;
      window.webContents.on('did-start-loading', () => {
        if (window.isVisible() || window.isFocused() || !window.webContents.isAudioMuted()) globalThis.webpageAudit.unsafe++;
      });
    };
    for (const window of BrowserWindow.getAllWindows()) watch(window);
    app.on('browser-window-created', (_event, window) => watch(window, true));
    shell.openExternal = async () => { globalThis.webpageAudit.external++; };
  });
  fixture = await createWebpageFixture(page, output);
  report.adaptiveResponse = await app.evaluate(async ({ session }, origin) => {
    const response = await session.fromPartition('web-test-response', { cache: false }).fetch(`${origin}/list.m3u8`);
    return { url: response.url, type: response.headers.get('content-type'), body: await response.text() };
  }, fixture.origin);
  report.responses = [];
  page.on('response', async response => {
    if (response.url().includes('/media/') && response.status() >= 400) {
      report.responses.push({ status: response.status(), body: await response.text().catch(() => '') });
    }
  });
  await app.evaluate(async ({ session }, origin) => {
    await session.defaultSession.cookies.set({ url: origin, name: 'daily_sentinel', value: '1' });
  }, fixture.origin);
  const open = async path => {
    report.currentPath = path;
    await page.getByRole('button', { name: '打开链接', exact: true }).click();
    await page.getByRole('textbox', { name: '视频地址', exact: true }).fill(`${fixture.origin}${path}`);
    await page.getByRole('button', { name: '打开视频', exact: true }).click();
    await page.waitForFunction(() => {
      const video = document.querySelector('.player video');
      return video?.videoWidth === 320 && video.currentTime > .15 && !video.error;
    }, undefined, { timeout: 35000 });
    assert.equal(await page.getByRole('dialog', { name: '打开链接', exact: true }).count(), 0);
    return page.locator('.player video').evaluate(video => ({ width: video.videoWidth, time: video.currentTime,
      frames: video.getVideoPlaybackQuality().totalVideoFrames, source: video.currentSrc }));
  };
  const exit = async () => {
    await revealPlayerControls(page);
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
  };
  const cases = ['/plain', '/embedded', '/delayed', '/metadata', '/config', '/button', '/protected',
    '/hidden-decoy', '/transparent-decoy', '/hidden-only', '/hidden-delayed', '/multiple-visible', '/visibility-changed',
    '/visible-unavailable', '/visible-gone', '/redirect-unavailable', '/recovered-source',
    '/fixture.mp4', '/hls-page', '/dash-page', '/template-page', '/redirect-page', '/blob-page'];
  for (const path of cases) {
    if (env.YINGJI_WEBPAGE_CASES && !env.YINGJI_WEBPAGE_CASES.split(',').includes(path)) continue;
    const observation = await open(path);
    assert.ok(observation.frames > 0);
    await exit();
    const history = await page.evaluate(() => window.hub.bootstrap().then(boot => boot.history));
    assert.equal(history[0].item.url, `${fixture.origin}${path}`);
    report.checks.push({ path, decoded: true, ...observation });
    await writeFile(resultPath, JSON.stringify(report, null, 2));
  }
  if (report.checks.some(check => check.path === '/recovered-source')) {
    const responses = fixture.requests.filter(request => request.path === '/recovered.webm').map(request => request.status);
    assert.ok(responses.includes(404));
    assert.ok(responses.some(status => status === 200 || status === 206));
    report.availabilityEvidence = { recovered: responses };
  }
  const before = fixture.requests.filter(request => request.path === '/guarded').map(request => request.generation);
  await open('/protected');
  await exit();
  const after = fixture.requests.filter(request => request.path === '/guarded').map(request => request.generation);
  assert.ok(after.some(value => !before.includes(value)));
  assert.ok(fixture.requests.filter(request => request.path === '/guarded').every(request => request.ownCookie));
  assert.ok(fixture.requests.every(request => !request.leaked));
  assert.ok(fixture.requests.every(request => !request.internalMarker));
  report.checks.push({ identity: 'original page persisted, fresh signed media on reopen, isolated cookies and referer' });
  await page.getByRole('button', { name: '打开链接', exact: true }).click();
  await page.getByRole('textbox', { name: '视频地址', exact: true }).fill(`${fixture.origin}/empty`);
  await page.getByRole('button', { name: '打开视频', exact: true }).click();
  await page.getByText('此网页尚未检测到可播放视频；请使用含视频的页面或媒体直链', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: '打开链接', exact: true }).count(), 1);
  report.checks.push({ empty: 'error preserves URL and retry dialog' });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '打开链接', exact: true }).click();
  const unavailableUrl = `${fixture.origin}/unavailable-only`;
  await page.getByRole('textbox', { name: '视频地址', exact: true }).fill(unavailableUrl);
  await page.getByRole('button', { name: '打开视频', exact: true }).click();
  await page.getByText('此网页的视频资源已失效，请刷新原网页后重试', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '视频地址', exact: true }).inputValue(), unavailableUrl);
  assert.equal(await page.getByRole('button', { name: '打开视频', exact: true }).evaluate(button => button === document.activeElement), true);
  assert.equal(await page.locator('.player').count(), 0);
  report.checks.push({ unavailable: 'observed missing media reports persistent inline failure and preserves URL/focused retry without opening a broken player' });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '打开链接', exact: true }).click();
  await page.getByRole('textbox', { name: '视频地址', exact: true }).fill(`${fixture.origin}/empty`);
  await page.getByRole('button', { name: '打开视频', exact: true }).click();
  await app.evaluate(async ({ BrowserWindow }) => {
    for (let attempt = 0; attempt < 100 && BrowserWindow.getAllWindows().length < 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (BrowserWindow.getAllWindows().length < 2) throw new Error('probe did not start');
  });
  const canceledAt = Date.now();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await app.evaluate(async ({ BrowserWindow }) => {
    for (let attempt = 0; attempt < 100 && BrowserWindow.getAllWindows().length > 1; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (BrowserWindow.getAllWindows().length !== 1) throw new Error('cancel retained a probe window');
  });
  assert.ok(Date.now() - canceledAt < 2500);
  assert.equal(await page.locator('.player').count(), 0);
  report.checks.push({ cancel: 'pending detection destroyed within 2.5 seconds and never starts playback' });
  report.audit = await app.evaluate(({ BrowserWindow }) => ({ ...globalThis.webpageAudit,
    windows: BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), focused: window.isFocused(), muted: window.webContents.isAudioMuted() })) }));
  for (const name of ['show', 'focus', 'external', 'unsafe']) assert.equal(report.audit[name], 0);
  assert.equal(report.audit.windows.length, 1);
  assert.ok(report.audit.probes > 0);
  assert.deepEqual(report.errors, []);
  report.completed = true;
} catch (error) {
  report.failure = error.message;
  report.requests = fixture?.requests;
  if (app) {
    const page = await app.firstWindow();
    report.player = await page.evaluate(() => {
      const video = document.querySelector('.player video');
      return { text: document.querySelector('.player')?.textContent, ready: video?.readyState,
        network: video?.networkState, error: video?.error?.message, time: video?.currentTime, width: video?.videoWidth };
    });
  }
  throw error;
} finally {
  if (app) await app.close();
  if (fixture) await fixture.close();
  await writeFile(resultPath, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
