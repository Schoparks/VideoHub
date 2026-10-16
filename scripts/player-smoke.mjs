import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { choosePlayerQuality } from './player-test-actions.mjs';

// Isolated fixtures exercise the real App, Player, preload bridge and media decoder.
await mkdir('.tmp/player-smoke', { recursive: true });
const profile = await mkdtemp(resolve('.tmp/player-smoke/profile-'));
const env = { ...process.env, YINGJI_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ args: ['.'], cwd: resolve('.'), env, timeout: 30000 });
app.process().stderr.on('data', data => process.stderr.write(data));
let mediaServer, page;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') console.error(entry.text()); });
  await page.getByRole('heading', { name: '首页' }).waitFor();
  console.log('Player smoke: renderer ready');
  const boot = await page.evaluate(() => window.hub.bootstrap());
  let sample;
  try { sample = await readFile('.tmp/smoke/跨平台样片.webm'); }
  catch {
    sample = Buffer.from(await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d'), stream = canvas.captureStream(12);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }), chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const ended = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start();
      const timer = setInterval(() => { context.fillStyle = '#2e6a50'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#f1fff6'; context.font = '24px sans-serif'; context.fillText('EPISODE TEST', 60, 90); }, 70);
      await new Promise(resolve => setTimeout(resolve, 4000)); recorder.stop(); await ended; clearInterval(timer);
      stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }));
    await writeFile('.tmp/player-smoke/fixture.webm', sample);
  }
  mediaServer = createServer((request, response) => {
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]),sample.length - 1) : sample.length - 1;
    if (start >= sample.length || end < start) { response.writeHead(416, { 'Content-Range': `bytes */${sample.length}` }); response.end(); return; }
    response.writeHead(match ? 206 : 200, { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(match ? { 'Content-Range': `bytes ${start}-${end}/${sample.length}` } : {}) });
    response.end(sample.subarray(start,end + 1));
  });
  await new Promise(resolve => mediaServer.listen(0,'127.0.0.1',resolve));
  const mediaUrl = `http://127.0.0.1:${mediaServer.address().port}/fixture.webm`;
  const series = { id: 'bili:episode-fixture', source: 'bilibili', kind: 'video', title: '分集播放回归', author: '隔离测试内容', aid: 170001, bvid: 'BV17x411w7KC', duration: 120 };
  const queued = { id: 'url:queue-fixture', source: 'url', kind: 'video', title: '队列下一部', url: mediaUrl };
  const parts = [1,2,3].map(index => ({ id: `cid:${1000 + index}`, cid: 1000 + index, title: `测试第 ${index} 集`, duration: 120 }));
  await app.evaluate(({ ipcMain }, fixture) => {
    const state = globalThis.playerSmoke = { resolves: [], progress: [], releases: [], fullscreen: [] };
    const replace = (name, handler) => { ipcMain.removeHandler(`hub:${name}`); ipcMain.handle(`hub:${name}`, async (_event,args) => ({ ok: true, data: await handler(...args) })); };
    replace('bootstrap', () => ({ ...fixture.boot, account: { app: true, web: true, appMid: 'fixture', webMid: 'fixture', storage: 'memory' }, queue: [fixture.series,fixture.queued], preferences: { ...fixture.boot.preferences, autoNext: false, syncHistory: false } }));
    replace('browse', () => ({ items: [fixture.series], hasMore: false }));
    replace('detail', item => ({ item, parts: item.id === fixture.series.id ? fixture.parts : [], description: '播放器回归样片' }));
    replace('resolve', (item,part,quality = 80) => {
      const selected = item.id === fixture.series.id ? part || fixture.parts[0] : undefined;
      const sessionId = `player-smoke-${state.resolves.length + 1}`;
      state.resolves.push({ item: item.id, part: selected?.id, quality, sessionId });
      // Completed/near-end history intentionally resumes at zero, matching backend policy.
      // App must explicitly override this on a quality change.
      return { sessionId, item, part: selected, parts: selected ? fixture.parts : [], url: `${fixture.mediaUrl}?session=${sessionId}`, format: 'file', startAt: 0, live: false, quality, qualities: [{ id: 80, label: '1080P' }, { id: 64, label: '720P' }, { id: 32, label: '480P' }] };
    });
    replace('progress', (sessionId,position,duration,flush) => { state.progress.push({ sessionId,position,duration,flush }); return { synced: false }; });
    replace('release', sessionId => { state.releases.push(sessionId); });
    replace('fullscreen', async value => {
      state.fullscreen.push(value);
      await new Promise(resolve => setTimeout(resolve, 150));
    });
  }, { boot,series,queued,parts,mediaUrl });
  await page.reload();
  await page.getByRole('button', { name: `播放 ${series.title}`, exact: true }).click();
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video && video.currentTime > .05 && video.videoWidth === 320 && !video.paused; });
  console.log('Player smoke: actual autoplay confirmed');
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.evaluate(() => {
    window.testPad = { id: 'Simulated Xbox player regression', mapping: 'standard', axes: [0,0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator,'getGamepads',{ configurable: true, value: () => [window.testPad] });
  });
  const press = async index => {
    await page.evaluate(async button => {
      window.testPad.buttons[button].pressed = true;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.testPad.buttons[button].pressed = false;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },index);
  };
  await press(9);
  await page.waitForFunction(() => document.querySelector('video')?.paused);
  await press(2);
  await page.getByRole('dialog', { name: '选择分集' }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-current') === 'true');
  assert.match(await page.locator('.controller-focus-hint').innerText(),/测试第 1 集/);
  await page.locator('.episode-option').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭选集');
  await page.keyboard.press('Shift+Tab');
  assert.match(await page.evaluate(() => document.activeElement?.textContent), /测试第 3 集/);
  await page.screenshot({ path: '.tmp/player-smoke/episode-picker.png' });
  await press(1);
  await page.waitForFunction(() => !document.querySelector('.episode-panel'));
  assert.equal(await page.locator('video').count(),1);
  await press(2);
  await page.getByRole('dialog', { name: '选择分集' }).waitFor();
  await press(13);
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('测试第 2 集'));
  await press(0);
  await page.waitForFunction(() => document.querySelector('.player-overlay header p')?.textContent?.includes('测试第 2 集'));
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video?.currentTime > .05 && !video.paused; });
  await press(9);
  assert.equal((await app.evaluate(() => globalThis.playerSmoke.resolves.at(-1))).part,'cid:1002');
  assert.equal(await page.getByRole('dialog').count(),0);

  // Seek within the backend's final-ten-seconds restart window, then change quality.
  const nearEnd = await page.locator('video').evaluate(async video => {
    video.pause();
    if (!Number.isFinite(video.duration)) { video.currentTime = 1e6; await new Promise(resolve => video.addEventListener('durationchange',resolve,{ once: true })); }
    const target = Math.max(.5,video.duration - 1.5);
    video.currentTime = target;
    await new Promise(resolve => video.addEventListener('seeked',resolve,{ once: true }));
    return target;
  });
  await choosePlayerQuality(page, 64);
  await page.waitForFunction(() => document.querySelector('video')?.currentSrc.includes('session=player-smoke-3'));
  await page.waitForFunction(target => { const video = document.querySelector('video'); return video && video.currentTime >= target && video.paused && video.readyState >= 2; },nearEnd);
  const resumed = await page.locator('video').evaluate(video => video.currentTime);
  assert.ok(resumed >= nearEnd && resumed < nearEnd + .65,`quality change lost position: ${nearEnd} -> ${resumed}`);
  const qualityRequest = await app.evaluate(() => globalThis.playerSmoke.resolves.at(-1));
  assert.equal(qualityRequest.part,'cid:1002'); assert.equal(qualityRequest.quality,64);
  await page.screenshot({ path: '.tmp/player-smoke/quality-progress.png' });

  // Loop this short isolated sample so the five-second idle timer can be exercised.
  await page.locator('video').evaluate(video => { video.loop = true; void video.play(); });
  await page.waitForFunction(() => !document.querySelector('.player').classList.contains('controls-visible'));
  assert.equal(await page.locator('.controller-focus-hint').isVisible(), false);
  assert.equal(await page.locator('.app-shell').evaluate(element => element.inert), true);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '暂停');
  await page.waitForFunction(() => !document.querySelector('.player').classList.contains('controls-visible'));
  await press(6);
  await page.locator('.seek-preview').waitFor();
  await press(3);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await press(1);
  assert.equal(await page.locator('.seek-preview').count(), 0);
  assert.equal(await page.locator('.player').count(), 1);
  await press(6);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.seek-preview'));
  await press(9);
  await page.waitForFunction(() => document.querySelector('video')?.paused);
  await page.locator('video').evaluate(video => { video.loop = false; });

  // RB must finish this title's remaining episodes before advancing its queue entry.
  await press(5);
  await page.waitForFunction(() => document.querySelector('.player-overlay header p')?.textContent?.includes('测试第 3 集'));
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > .05);
  await press(9);
  assert.equal((await app.evaluate(() => globalThis.playerSmoke.resolves.at(-1))).part,'cid:1003');
  await press(5);
  await page.getByRole('heading', { name: queued.title, exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > .05);
  await press(9);
  assert.equal((await app.evaluate(() => globalThis.playerSmoke.resolves.at(-1))).item,queued.id);
  const requests = await app.evaluate(() => globalThis.playerSmoke.resolves);
  assert.deepEqual(requests.map(request => [request.item,request.part,request.quality]),[
    [series.id,'cid:1001',80], [series.id,'cid:1002',80], [series.id,'cid:1002',64], [series.id,'cid:1003',64], [queued.id,undefined,80]
  ]);
  await page.getByRole('button', { name: '播放器全屏', exact: true }).click();
  await press(1);
  await page.waitForFunction(() => document.querySelector('.player:not(.controls-visible)'));
  await press(1);
  await page.waitForFunction(() => !document.querySelector('.player'));
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-media-id') === 'bili:episode-fixture');
  const state = await app.evaluate(() => globalThis.playerSmoke);
  assert.ok(state.progress.some(entry => entry.sessionId === 'player-smoke-2' && entry.flush && Math.abs(entry.position - nearEnd) < .1));
  assert.ok(requests.every(request => state.releases.includes(request.sessionId)));
  assert.deepEqual(state.fullscreen, [true, false], 'exiting during fullscreen entry must restore the browse window');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ result: 'passed', nearEnd, resumed, checks: ['video card directly autoplays real VP8', 'gamepad X opens episodes and focuses current episode', 'episode Tab focus stays in picker', 'B closes picker without exiting playback', 'gamepad chooses second episode', 'quality switch preserves exact near-end progress', 'idle controls and hints hide without reaching background; Tab reveals controls', 'seek preview confines input; Back cancels and Enter commits', 'RB prefers third episode before next queue entry', 'B hides controls before exit and restores card focus', 'source changes save progress and release old sessions'], errors },null,2));
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: '.tmp/player-smoke/failure.png',timeout: 2000 }).catch(() => {}); console.error(await page.locator('body').innerText({ timeout: 2000 }).catch(() => 'body unavailable')); }
  throw error;
} finally {
  await app.close();
  if (mediaServer) await new Promise(resolve => mediaServer.close(resolve));
}
