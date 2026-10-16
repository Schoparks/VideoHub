import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Exercise the built renderer with cumulative provider-shaped fixtures only.
// No real account is read or used: Electron has a separate userData directory.
const output = resolve('.tmp/recommendation-smoke');
await mkdir(output, { recursive: true });
await readFile('dist/index.html');
await readFile('dist-electron/main.cjs');
const profile = await mkdtemp(resolve(output, 'profile-'));
const env = { ...process.env, YINGJI_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const executablePath = process.env.YINGJI_EXECUTABLE;
const hidden = env.YINGJI_TEST_HIDDEN === '1';
const app = await electron.launch({ executablePath,
  args: [...(executablePath ? [] : ['.']), ...(hidden ? [] : ['--disable-gpu', '--in-process-gpu'])],
  cwd: resolve('.'), env, timeout: 30000 });
const auditWindow = async () => {
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
    visible: window.isVisible(), focused: window.isFocused(), muted: window.webContents.isAudioMuted(),
  })));
  if (hidden) assert.ok(windows.length === 1 && windows.every(window => !window.visible && !window.focused && window.muted));
  return windows;
};
let mediaServer;
const checks = [];
try {
  const page = await app.firstWindow();
  await auditWindow();
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 950 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '首页' }).waitFor();
  assert.equal(new URL(page.url()).protocol, 'yingji:');
  const boot = await page.evaluate(() => window.hub.bootstrap());
  let sample;
  try { sample = await readFile('.tmp/smoke/跨平台样片.webm'); }
  catch {
    sample = Buffer.from(await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d'), stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }), chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const ended = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start();
      const timer = setInterval(() => { context.fillStyle = '#315f4e'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#fff'; context.font = '20px sans-serif'; context.fillText('RECOMMENDATION TEST', 25, 90); }, 80);
      await new Promise(resolve => setTimeout(resolve, 1200)); recorder.stop(); await ended; clearInterval(timer);
      stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }));
    await writeFile(resolve(output, 'fixture.webm'), sample);
  }
  mediaServer = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'video/webm' }); res.end(sample); });
  await new Promise(resolve => mediaServer.listen(0, '127.0.0.1', resolve));
  const mediaUrl = `http://127.0.0.1:${mediaServer.address().port}/fixture.webm`;
  await app.evaluate(({ ipcMain }, fixture) => {
    const state = globalThis.recommendationSmoke = { browse: [], resolve: [], releases: [], items: [], epoch: 1, active: 0, maxActive: 0 };
    const replace = (name, handler) => { ipcMain.removeHandler(`hub:${name}`); ipcMain.handle(`hub:${name}`, async (_event, args) => ({ ok: true, data: await handler(...args) })); };
    replace('bootstrap', () => ({ ...fixture.boot, library: [], history: [], queue: [], account: { app: true, web: true, appMid: 'recommendation-fixture', webMid: 'recommendation-fixture', name: '推荐隔离测试账号', storage: 'memory' } }));
    replace('browse', async request => {
      if (request.kind !== 'recommend') return { items: [], hasMore: false };
      state.browse.push({ ...request });
      state.active++; state.maxActive = Math.max(state.maxActive, state.active);
      try {
        if (request.refresh) { state.items = []; state.epoch++; }
        await new Promise(resolve => setTimeout(resolve, 90));
        const start = state.items.length;
        for (let offset = 1; offset <= 7; offset++) {
          const index = start + offset;
          state.items.push({ id: `bili:fixture-${state.epoch}-${index}`, source: 'bilibili', kind: 'video', title: `推荐测试 ${state.epoch} · ${String(index).padStart(3, '0')}`, author: '推荐测试 UP', aid: state.epoch * 10000 + index, cid: index, duration: 190 });
        }
        return { items: [...state.items], cursor: `${state.epoch}:${state.items.length}`, hasMore: true };
      } finally { state.active--; }
    });
    replace('resolve', async item => {
      state.resolve.push(item.id);
      return { sessionId: `recommendation-smoke-${state.resolve.length}`, item, parts: [], url: fixture.mediaUrl, format: 'file', startAt: 0, live: false };
    });
    replace('progress', () => ({ synced: false }));
    replace('release', sessionId => { state.releases.push(sessionId); });
  }, { boot, mediaUrl });
  const state = () => app.evaluate(() => ({ browse: globalThis.recommendationSmoke.browse, maxActive: globalThis.recommendationSmoke.maxActive, active: globalThis.recommendationSmoke.active, resolve: globalThis.recommendationSmoke.resolve, releases: globalThis.recommendationSmoke.releases }));
  const ids = () => page.locator('.media-card').evaluateAll(cards => cards.map(card => card.dataset.mediaId));
  const settleAt = async count => {
    await page.waitForFunction(count => document.querySelectorAll('.media-card').length === count
      && document.querySelector('.feed-results')?.getAttribute('aria-busy') === 'false', count);
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.media-card').count(), count);
  };
  const settleFeed = async () => {
    let previousCount = -1;
    for (let attempt = 0; attempt < 50; attempt++) {
      await page.waitForTimeout(200);
      const snapshot = await state();
      const count = await page.locator('.media-card').count();
      const loading = await page.locator('.feed-results').getAttribute('aria-busy') === 'true';
      if (count >= 30 && count === previousCount && !loading && !snapshot.active) {
        // Hidden native windows throttle animation frames; a short quiet period
        // can sit between two batches of the same recommendation round.
        await page.waitForTimeout(hidden ? 1500 : 400);
        if (count === await page.locator('.media-card').count()
          && !(await state()).active
          && await page.locator('.feed-results').getAttribute('aria-busy') === 'false') {
          const distance = await page.locator('main').evaluate(main =>
            main.scrollHeight - main.clientHeight - main.scrollTop - main.clientHeight);
          assert.ok(distance > 0, 'feed must fill the one-viewport prefetch buffer before settling');
          return count;
        }
      }
      previousCount = count;
    }
    throw new Error('Recommendation feed did not settle outside the prefetch zone');
  };
  const expectedCursors = (epoch, start, count) => Array.from({ length: count / 7 }, (_, index) => {
    const retained = start + index * 7;
    return retained ? `${epoch}:${retained}` : undefined;
  });
  const setScroll = position => page.evaluate(position => {
    const main = document.querySelector('main');
    main.scrollTop = position === 'bottom' ? main.scrollHeight : position === 'near-bottom' ? main.scrollHeight - main.clientHeight * 1.5 : 0;
    main.dispatchEvent(new Event('scroll'));
  }, position);
  await page.reload();
  const initialCount = await settleFeed();
  const initialRequests = initialCount / 7;
  assert.equal(initialCount % 35, 0);
  let snapshot = await state();
  assert.equal(snapshot.browse.length, initialRequests);
  assert.equal(snapshot.maxActive, 1);
  assert.deepEqual(snapshot.browse.map(({ cursor }) => cursor), expectedCursors(1, 0, initialCount));
  const firstIds = await ids();
  assert.deepEqual(firstIds, Array.from({ length: initialCount }, (_, i) => `bili:fixture-1-${i + 1}`));
  checks.push('initial feed serially loads at least 30 items in server order and stops with a full viewport buffer');

  await page.getByRole('button', { name: '哔哩哔哩', exact: true }).click();
  await settleAt(initialCount);
  assert.deepEqual(await ids(), firstIds);
  assert.equal((await state()).browse.length, initialRequests);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await settleAt(initialCount);
  assert.deepEqual(await ids(), firstIds);
  assert.equal((await state()).browse.length, initialRequests);
  checks.push('Home and Bilibili reuse the same recommendation list without requesting another batch');

  await page.getByRole('button', { name: '打开链接', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await setScroll('bottom');
  await page.waitForTimeout(400);
  assert.equal((await state()).browse.length, initialRequests);
  await setScroll('top');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await setScroll('bottom');
  await page.waitForTimeout(400);
  assert.equal((await state()).browse.length, initialRequests);
  await setScroll('top');
  await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  checks.push('dialogs and hidden pages suspend recommendation prefetch');

  await setScroll('near-bottom');
  const appendedCount = await settleFeed();
  const additions = appendedCount - initialCount;
  assert.ok(additions >= 30, JSON.stringify({ initialCount, appendedCount, snapshot: await state(),
    viewport: await page.locator('main').evaluate(main => ({ scroll: main.scrollTop, height: main.scrollHeight,
      client: main.clientHeight, visibility: document.visibilityState })) }));
  assert.equal(additions % 35, 0);
  snapshot = await state();
  const appendedRequests = appendedCount / 7;
  assert.equal(snapshot.browse.length, appendedRequests);
  assert.equal(snapshot.maxActive, 1);
  assert.deepEqual(snapshot.browse.slice(initialRequests).map(({ cursor }) => cursor), expectedCursors(1, initialCount, additions));
  const allIds = await ids();
  assert.deepEqual(allIds.slice(0, initialCount), firstIds);
  checks.push('entering the one-viewport prefetch zone starts another serial round of at least 30 additions');

  await setScroll('top');
  await page.getByRole('button', { name: '播放 推荐测试 1 · 001', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > .05);
  await setScroll('bottom');
  await page.waitForTimeout(400);
  assert.equal((await state()).browse.length, appendedRequests);
  await setScroll('top');
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.locator('.player').waitFor({ state: 'hidden' });
  await settleAt(appendedCount);
  assert.deepEqual(await ids(), allIds);
  snapshot = await state();
  assert.equal(snapshot.browse.length, appendedRequests);
  assert.deepEqual(snapshot.resolve, ['bili:fixture-1-1']);
  assert.deepEqual(snapshot.releases, ['recommendation-smoke-1']);
  checks.push('actual playback pauses prefetch and returning preserves the existing feed');

  await page.getByRole('button', { name: '换一批', exact: true }).click();
  await page.waitForFunction(() => !document.querySelectorAll('.media-card').length);
  const refreshedCount = await settleFeed();
  assert.equal(refreshedCount, initialCount);
  snapshot = await state();
  assert.equal(snapshot.browse.length, appendedRequests + initialRequests);
  assert.equal(snapshot.browse[appendedRequests].refresh, true);
  assert.equal(snapshot.browse[appendedRequests].cursor, undefined);
  assert.equal(snapshot.browse[appendedRequests].page, 1);
  assert.deepEqual(snapshot.browse.slice(appendedRequests).map(({ cursor }) => cursor), expectedCursors(2, 0, refreshedCount));
  assert.deepEqual(await ids(), Array.from({ length: refreshedCount }, (_, i) => `bili:fixture-2-${i + 1}`));
  assert.equal(await page.locator('main').evaluate(main => main.scrollTop), 0);
  assert.equal(snapshot.maxActive, 1);
  checks.push('refresh clears the old list, starts without cursor at page 1, and resets the target to 30');
  assert.deepEqual(errors, []);
  if (hidden) {
    const pixels = await app.evaluate(async ({ BrowserWindow }) => {
      const snapshot = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true });
      return Array.from(snapshot.toPNG());
    });
    assert.ok(pixels.length > 0);
    await writeFile(resolve(output, 'recommendations.png'), Buffer.from(pixels));
  } else await page.screenshot({ path: resolve(output, 'recommendations.png'), fullPage: true, animations: 'disabled' });
  const result = { result: 'passed', hidden, packaged: !!executablePath, windows: await auditWindow(), builtRenderer: page.url(), profile,
    requestCount: snapshot.browse.length, maxConcurrentRequests: snapshot.maxActive, checks, errors };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.close();
  if (mediaServer) await new Promise(resolve => mediaServer.close(resolve));
}
