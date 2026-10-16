import { _electron as electron } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// All account/content responses below are test fixtures in an isolated Electron process.
await mkdir('.tmp/dynamic-smoke', { recursive: true });
const profile = await mkdtemp(resolve('.tmp/dynamic-smoke/profile-'));
const vite = await createViteServer();
await vite.listen();
const env = { ...process.env, YINGJI_TEST_DATA: profile, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--disable-gpu', '--in-process-gpu'], cwd: resolve('.'), env, timeout: 30000 });
app.process().stderr.on('data', data => process.stderr.write(data));
let mediaServer;
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 1280 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '首页' }).waitFor();
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
      const timer = setInterval(() => { context.fillStyle = '#2c7253'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#fff'; context.font = '24px sans-serif'; context.fillText('DYNAMIC TEST', 55, 90); }, 80);
      await new Promise(resolve => setTimeout(resolve, 1500)); recorder.stop(); await ended; clearInterval(timer);
      stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }));
    await writeFile('.tmp/dynamic-smoke/fixture.webm', sample);
  }
  mediaServer = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'video/webm' }); res.end(sample); });
  await new Promise(resolve => mediaServer.listen(0, '127.0.0.1', resolve));
  const mediaUrl = `http://127.0.0.1:${mediaServer.address().port}/fixture.webm`;
  let imagesLoaded = 0;
  await page.route('https://fixture.example/**', async route => {
    imagesLoaded++;
    const text = route.request().url().includes('cover') ? 'MOUNTAIN JOURNAL' : 'WEEKEND WALK';
    await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#b6d9c9"/><stop offset="1" stop-color="#315f4e"/></linearGradient></defs><rect width="960" height="540" fill="url(#g)"/><circle cx="735" cy="130" r="68" fill="#f0e6b5"/><path d="M0 440L200 180 400 370 600 200 960 440V540H0Z" fill="#315a4c"/><path d="M0 500L230 345 380 450 650 300 960 475V540H0Z" fill="#203e37"/><text x="50" y="78" fill="white" font-family="sans-serif" font-size="28" letter-spacing="6">${text}</text><text x="52" y="112" fill="#e9fff2" font-family="sans-serif" font-size="15">ISOLATED UI TEST FIXTURE</text></svg>` });
  });
  const cover = 'https://fixture.example/cover.svg', picture = 'https://fixture.example/picture.svg', avatar = 'https://fixture.example/avatar.svg';
  const video = { id: 'bili:fixture-video', source: 'bilibili', kind: 'video', title: '山间记录 · 视频动态测试', author: '测试 UP · 山间', bvid: 'BV17x411w7KC', aid: 170001, cid: 1001, cover, duration: 190 };
  const secondVideo = { ...video, id: 'bili:fixture-video-two', title: '第二条视频 · 分页测试', cid: 1002 };
  const all = [
    { id: 'dynamic-video', author: video.author, avatar, text: '这周的山间记录，带大家一起听风。', images: [], video, publishedAt: 1790400000000, url: 'https://t.bilibili.com/1' },
    { id: 'dynamic-text', author: '测试 UP · 文字', avatar, text: '纯文字动态测试：今天也别忘记抬头看看天空。\n这条内容没有视频或配图。', images: [], publishedAt: 1790396400000, url: 'https://t.bilibili.com/2' },
    { id: 'dynamic-picture', author: '测试 UP · 图文', avatar, text: '周末散步，留下一张风景。', images: [picture], publishedAt: 1790392800000, url: 'https://t.bilibili.com/3' },
    { id: 'dynamic-repost', author: '测试 UP · 转发', avatar, text: '转发动态测试：收藏这份好心情。', images: [], original: { id: 'dynamic-original', author: '原作者 · 测试', text: '被转发的原始动态正文。', images: [picture], url: 'https://t.bilibili.com/4' }, publishedAt: 1790389200000, url: 'https://t.bilibili.com/5' }
  ];
  const allMore = { ...all[1], id: 'dynamic-text-more', text: '全部筛选第二页：这条内容只出现一次。' };
  const videoMore = { ...all[0], id: 'dynamic-video-more', video: secondVideo, text: '视频筛选第二页。' };
  await app.evaluate(({ ipcMain }, fixture) => {
    const state = globalThis.dynamicSmoke = { browse: [], resolve: [], detail: [], releases: [], deferNextResolve: false };
    const replace = (name, handler) => { ipcMain.removeHandler(`hub:${name}`); ipcMain.handle(`hub:${name}`, async (_event, args) => ({ ok: true, data: await handler(...args) })); };
    replace('bootstrap', () => ({ ...fixture.boot, account: { app: true, web: true, appMid: 'fixture', webMid: 'fixture', name: '隔离测试账号', storage: 'memory' } }));
    replace('browse', request => {
      state.browse.push(request);
      if (request.kind !== 'dynamic') return { items: [], hasMore: false };
      const videoOnly = request.dynamicType === 'video', more = !!request.cursor;
      return { items: [], dynamics: videoOnly ? more ? [fixture.all[0], fixture.videoMore] : [fixture.all[0]] : more ? [fixture.all[1], fixture.allMore] : fixture.all, hasMore: !more, cursor: `${videoOnly ? 'video' : 'all'}-cursor-${more ? '2' : '1'}` };
    });
    replace('detail', item => { state.detail.push(item.id); return { item, parts: [{ id: '1001', cid: 1001, title: '第一集' }, { id: '1002', cid: 1002, title: '第二集' }], description: '隔离 UI 测试中的视频简介。' }; });
    replace('resolve', async (item, part) => {
      state.resolve.push({ item: item.id, part });
      const sessionId = `dynamic-smoke-${state.resolve.length}`;
      if (state.deferNextResolve) { state.deferNextResolve = false; await new Promise(resolve => { state.finishResolve = resolve; }); }
      return { sessionId, item, part: part || { id: '1001', cid: 1001, title: '第一集' }, parts: [{ id: '1001', cid: 1001, title: '第一集' }, { id: '1002', cid: 1002, title: '第二集' }], url: fixture.mediaUrl, format: 'file', startAt: 0, live: false };
    });
    replace('progress', () => ({ synced: false }));
    replace('release', sessionId => { state.releases.push(sessionId); });
  }, { boot, all, allMore, videoMore, mediaUrl });
  await page.reload();
  await page.getByRole('button', { name: '哔哩哔哩', exact: true }).click();
  await page.getByRole('button', { name: '关注动态', exact: true }).click();
  await page.getByText('纯文字动态测试：', { exact: false }).waitFor();
  assert.equal(await page.locator('.dynamic-original').count(), 1);
  assert.equal(await page.locator('.dynamic-images').count(), 2);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.dynamic-feed img')).every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: '.tmp/dynamic-smoke/all-dynamics.png', fullPage: true });
  await page.locator('main').evaluate(main => {
    main.scrollTop = main.scrollHeight;
    main.dispatchEvent(new Event('scroll'));
  });
  await page.getByText('全部筛选第二页：这条内容只出现一次。', { exact: true }).waitFor();
  assert.equal(await page.locator('.dynamic-entry').count(), 5);
  assert.equal(await page.getByText('纯文字动态测试：', { exact: false }).count(), 1);
  await page.getByRole('button', { name: '视频', exact: true }).click();
  assert.equal(await page.getByText('纯文字动态测试：', { exact: false }).count(), 0);
  await page.getByText('视频筛选第二页。', { exact: true }).waitFor();
  assert.equal(await page.locator('.dynamic-entry').count(), 2);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.dynamic-entry').length === 5);
  await page.getByRole('button', { name: '视频', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.dynamic-entry').length === 2);
  const requests = await app.evaluate(() => globalThis.dynamicSmoke.browse.filter(request => request.kind === 'dynamic'));
  assert.deepEqual(requests.map(({ dynamicType, cursor, page }) => ({ dynamicType, cursor, page })), [
    { dynamicType: 'all', cursor: undefined, page: 1 }, { dynamicType: 'all', cursor: 'all-cursor-1', page: 2 },
    { dynamicType: 'video', cursor: undefined, page: 1 }, { dynamicType: 'video', cursor: 'video-cursor-1', page: 2 }
  ]);
  const card = page.getByRole('button', { name: `播放 ${video.title}`, exact: true });
  await card.click();
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > .05);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(await app.evaluate(() => ({ resolve: globalThis.dynamicSmoke.resolve.length, detail: globalThis.dynamicSmoke.detail.length })), { resolve: 1, detail: 0 });
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  await card.focus();
  await page.keyboard.press('x');
  await page.getByRole('dialog').waitFor();
  await page.getByText('隔离 UI 测试中的视频简介。', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: `详情 ${video.title}`, exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByText('隔离 UI 测试中的视频简介。', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.testPad = { id: 'Simulated Xbox dynamic focus', mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.testPad] });
  });
  await card.focus();
  await page.waitForFunction(() => document.documentElement.dataset.inputMode === 'gamepad');
  await app.evaluate(() => { globalThis.dynamicSmoke.deferNextResolve = true; });
  await card.click();
  await page.locator('.working-pill').waitFor();
  await app.evaluate(async () => {
    for (let attempt = 0; attempt < 100 && !globalThis.dynamicSmoke.finishResolve; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    if (!globalThis.dynamicSmoke.finishResolve) throw new Error('Deferred resolve was never requested');
  });
  await page.evaluate(async () => {
    window.testPad.buttons[1].pressed = true;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.testPad.buttons[1].pressed = false;
  });
  await page.locator('.working-pill').waitFor({ state: 'hidden' });
  await app.evaluate(() => { globalThis.dynamicSmoke.finishResolve(); });
  await app.evaluate(async () => {
    for (let attempt = 0; attempt < 100 && !globalThis.dynamicSmoke.releases.includes('dynamic-smoke-2'); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    if (!globalThis.dynamicSmoke.releases.includes('dynamic-smoke-2')) throw new Error('Cancelled playback session was not released');
  });
  assert.equal(await page.locator('.player').count(), 0);
  await card.click();
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > .05);
  assert.equal(await app.evaluate(() => globalThis.dynamicSmoke.resolve.length), 3);
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  await card.focus();
  await page.evaluate(async () => {
    window.testPad.axes[0] = -.5;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.testPad.axes[0] = 0;
  });
  await card.focus();
  await page.screenshot({ path: '.tmp/dynamic-smoke/video-focus.png', fullPage: true });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.card-details')).position), 'absolute');
  assert.ok(imagesLoaded >= 3);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', imagesLoaded, checks: ['Bilibili following dynamics navigation', 'text/images/reposts/video rendering', 'all/video independent cached cursor pagination and deduplication', 'cover images load', 'video card starts actual playback without details', 'X and details button open details', 'B cancels pending playback and releases the late session', 'playback can reopen after cancellation', 'controller card focus preserves details-button placement'], errors }, null, 2));
} finally {
  await app.close();
  if (mediaServer) await new Promise(resolve => mediaServer.close(resolve));
  await vite.close();
}
