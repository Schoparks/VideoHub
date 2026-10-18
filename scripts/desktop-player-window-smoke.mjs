import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { phoneMediaFixture } from './phone-media-fixture.mjs';

const output = resolve('.tmp/desktop-player-window');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(`${output}/profile-`);
const sample = await phoneMediaFixture();
const server = createServer((request, response) => {
  assert.equal(request.headers.cookie, undefined);
  response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': sample.length });
  response.end(sample);
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const env = { ...process.env, YINGJI_TEST_DATA: profile, YINGJI_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let app;
const checks = [];
try {
  app = await electron.launch({
    ...(process.env.YINGJI_EXECUTABLE
      ? { executablePath: resolve(process.env.YINGJI_EXECUTABLE), args: [] } : { args: ['.'] }),
    cwd: process.cwd(), env, timeout: 30000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
  for (const tvMode of [false, true]) {
    if (tvMode) {
      await page.getByRole('button', { name: '切换电视模式', exact: true }).click();
      await page.waitForFunction(async () => (await window.hub.bootstrap()).preferences.tvMode);
    }
    assert.equal(await page.evaluate(() => window.hub.getFullscreen()), false);
    await page.getByRole('button', { name: '打开链接', exact: true }).click();
    await page.getByRole('textbox', { name: '视频地址', exact: true }).fill(
      `http://127.0.0.1:${server.address().port}/fixture.mp4`);
    await page.getByRole('button', { name: '打开视频', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0
      && document.querySelector('video').currentTime > .2);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const video = await page.locator('video').elementHandle();
    const fullscreen = page.getByRole('button', { name: '播放器全屏', exact: true });
    await fullscreen.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="播放器全屏"]')?.getAttribute('aria-busy') !== 'true');
    assert.equal(await page.evaluate(() => window.hub.getFullscreen()), false);
    assert.equal(await video.evaluate(node => node === document.querySelector('video') && node.paused), true);
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    assert.equal(await page.evaluate(() => window.hub.getFullscreen()), false);
    assert.equal(await page.evaluate(async () => (await window.hub.bootstrap()).preferences.tvMode), tvMode);
    checks.push(`TV=${tvMode}: real MP4, window IPC/button, hidden fullscreen guard, paused node and return state`);
  }
  assert.equal(await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(window => window.isVisible())), false);
  assert.deepEqual(errors, []);
  const report = { passed: true, checks, errors, nativeAnimationTested: false };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
}
