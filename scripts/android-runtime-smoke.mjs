import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _android as android } from 'playwright';

const serial = process.env.YINGJI_ANDROID_SERIAL;
if (!serial?.startsWith('emulator-')) throw new Error('只允许显式指定本次隔离模拟器 YINGJI_ANDROID_SERIAL');
const sdk = process.env.ANDROID_HOME || resolve('.tmp/android-tools/sdk');
const adb = resolve(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const output = resolve('.tmp/android-tv-smoke');
await mkdir(output, { recursive: true });
await writeFile(`${output}/runtime-report.json`, JSON.stringify({ status: 'running', serial }));
async function command(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(adb, ['-s', serial, ...args], { windowsHide: true });
    const chunks = [], errors = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveRun(Buffer.concat(chunks)) : reject(new Error(Buffer.concat(errors).toString())));
  });
}
const devices = await android.devices({ omitDriverInstall: true });
const device = devices.find(device => device.serial() === serial);
assert.ok(device, 'specified isolated emulator must be connected');
const webview = await device.webView({ pkg: 'app.yingji.tv' });
const first = await webview.page();
const pages = first.context().pages();
const page = pages.find(page => page.url() === 'https://app.yingji.local/index.html');
const backend = pages.find(page => page.url().includes('/backend/'));
assert.ok(page && backend, 'both isolated WebViews must be running');
page.setDefaultTimeout(15000);
const requests = [];
const sample = await readFile('.tmp/webpage-playback/fixture.mp4');
const server = createServer((request, response) => {
  requests.push({ url: request.url, range: request.headers.range, cookie: !!request.headers.cookie });
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(sample.length - 1, Number(range[2])) : sample.length - 1;
  response.writeHead(range ? 206 : 200, {
    'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${sample.length}` } : {}),
  });
  response.end(sample.subarray(start, end + 1));
});
await new Promise(resolveRun => server.listen(0, '127.0.0.1', resolveRun));
const mediaUrl = `http://10.0.2.2:${server.address().port}/fixture.mp4`;
const checks = [];
const remote = async key => { await command(['shell', 'input', 'keyevent', String(key)]); await page.waitForTimeout(100); };
try {
  const boot = await page.evaluate(() => window.hub.bootstrap());
  assert.equal(boot.platform, 'android');
  assert.equal(boot.preview, undefined);
  assert.equal(boot.preferences.tvMode, true);
  assert.equal(await page.evaluate(() => typeof window.Backend), 'undefined');
  assert.equal(await backend.evaluate(() => typeof window.HubBridge), 'undefined');
  checks.push('APK native bootstrap and mutually isolated UI/backend bridges');
  await remote(82);
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  await remote(20);
  const dark = page.getByRole('switch', { name: '深色外观', exact: true });
  assert.equal(await dark.evaluate(node => node === document.activeElement), true);
  const before = await dark.isChecked();
  await remote(23);
  assert.equal(await dark.isChecked(), !before);
  assert.equal((await page.evaluate(() => window.hub.bootstrap())).preferences.theme, before ? 'light' : 'dark');
  await remote(4);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  checks.push('native MENU / D-pad / center / back and atomic preference save');
  await page.getByRole('button', { name: '打开链接', exact: true }).click();
  await page.getByRole('textbox', { name: '视频地址', exact: true }).fill(mediaUrl);
  await page.locator('.url-form button').click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && video.readyState >= 2 && video.getVideoPlaybackQuality().totalVideoFrames > 0;
  }, null, { timeout: 30000 });
  const playback = await page.locator('video').evaluate(video => ({
    duration: video.duration, width: video.videoWidth, frames: video.getVideoPlaybackQuality().totalVideoFrames,
    url: video.currentSrc, playing: !video.paused,
  }));
  assert.ok(playback.width > 0 && playback.frames > 0);
  assert.ok(playback.url.startsWith('https://app.yingji.local/media/'));
  assert.ok(requests.length > 0 && requests.every(request => !request.cookie));
  await page.getByRole('button', { name: '暂停', exact: true }).focus();
  await remote(23);
  await page.waitForFunction(() => document.querySelector('video')?.paused);
  const timeline = page.getByRole('slider', { name: '播放进度', exact: true });
  await timeline.focus();
  await remote(22);
  assert.equal(await page.locator('.player').getAttribute('data-seeking'), 'true');
  await remote(4);
  await timeline.focus();
  await remote(22);
  await remote(23);
  const target = Math.min(10, playback.duration);
  await page.waitForFunction(target => document.querySelector('video')?.currentTime >= target - .05, target);
  await remote(4);
  await remote(4);
  await page.locator('.player').waitFor({ state: 'detached' });
  const history = (await page.evaluate(() => window.hub.bootstrap())).history;
  assert.ok(history.some(entry => entry.item.url === mediaUrl && entry.position >= target - .05));
  checks.push('actual MP4 frames, opaque native Range channel, pause/seek/cancel/exit and persisted history');
  const encrypted = await backend.evaluate(() => {
    const marker = 'isolated-storage-test';
    const error = window.Backend.write('account', JSON.stringify({ marker }));
    const roundTrip = window.Backend.read('account');
    window.Backend.write('account', '{}');
    return { secure: window.Backend.secure(), error, roundTrip };
  });
  assert.equal(encrypted.secure, true);
  assert.equal(encrypted.error, '');
  assert.equal(JSON.parse(encrypted.roundTrip).marker, 'isolated-storage-test');
  checks.push('Android Keystore encrypt/decrypt round trip with synthetic noncredential data');
  await page.getByRole('textbox', { name: '搜索视频', exact: true }).focus();
  await remote(23);
  await page.locator('.screen-keyboard').waitFor();
  await page.locator('[data-keyboard-start]').focus();
  await remote(23);
  assert.equal(await page.locator('[data-screen-keyboard]').getAttribute('data-composing'), 'true');
  await remote(4);
  assert.equal(await page.locator('[data-screen-keyboard]').getAttribute('data-composing'), 'false');
  await remote(4);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  checks.push('bundled pinyin keyboard opens/confirms/cancels through native center/back keys');
  const report = { serial, android: '14 / API 34', webview: '113.0.5672.136', checks, playback, requests, passed: true };
  await writeFile(`${output}/runtime-report.json`, JSON.stringify(report, null, 2));
  await writeFile(`${output}/home.png`, await command(['exec-out', 'screencap', '-p']));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(`${output}/failure.png`, await command(['exec-out', 'screencap', '-p']));
  await writeFile(`${output}/runtime-report.json`, JSON.stringify({ status: 'failed', serial, error: error.message }));
  throw error;
} finally {
  await device.close();
  await new Promise(resolveRun => server.close(resolveRun));
}
