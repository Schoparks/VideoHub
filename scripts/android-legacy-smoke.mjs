import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const serial = process.env.YINGJI_ANDROID_SERIAL;
const output = '.tmp/android-legacy-smoke';
await mkdir(output, { recursive: true });
const connection = await connectLegacyWebViews(serial);
const { pages, command } = connection;
const page = pages.find(page => page.url.endsWith('/index.html') && !page.url.includes('/backend/'));
const backend = pages.find(page => page.url.includes('/backend/'));
assert.ok(page && backend);
const checks = [], requests = [];
const samplePath = process.env.YINGJI_ANDROID_SAMPLE || '.tmp/android-legacy-media/fixture.mp4';
const sample = await readFile(samplePath);
const server = createServer((request, response) => {
  requests.push({ range: request.headers.range, cookie: !!request.headers.cookie });
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(sample.length - 1, Number(range[2])) : sample.length - 1;
  response.writeHead(range ? 206 : 200, {
    'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${sample.length}` } : {}),
  });
  response.end(sample.subarray(start, end + 1));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const mediaUrl = `http://10.0.2.2:${server.address().port}/fixture.mp4`;
const remote = async key => {
  await command(['shell', 'input', 'keyevent', String(key)]);
  await new Promise(resolve => setTimeout(resolve, 100));
};
const focus = selector => page.evaluate(selector => {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing focus target: ${selector}`);
  node.focus();
  if (document.activeElement !== node) throw new Error(`Focus rejected: ${selector}`);
}, selector);
try {
  const provider = (await command(['shell', 'dumpsys', 'webviewupdate'])).toString();
  assert.match(provider, /66\.0\.3359\.158/);
  assert.equal((await command(['shell', 'getprop', 'ro.build.version.sdk'])).toString().trim(), '28');
  await page.wait(() => window.hub && document.querySelector('.nav-item'));
  const boot = await page.evaluate(() => window.hub.bootstrap());
  assert.equal(boot.platform, 'android');
  const manifest = await readFile('android/AndroidManifest.xml', 'utf8');
  assert.equal(boot.version, /android:versionName="([^"]+)-tv"/.exec(manifest)[1]);
  assert.equal(boot.preferences.tvMode, true);
  assert.equal(await page.evaluate(() => typeof window.Backend), 'undefined');
  assert.equal(await backend.evaluate(() => typeof window.HubBridge), 'undefined');
  await page.wait(() => document.querySelector('.nav-item'));
  checks.push('Android 9 / exact WebView 66.0.3359.158 native bootstrap and isolated bridges');
  await remote(82);
  await page.wait(() => document.querySelector('[role="dialog"]'));
  await remote(20);
  const switchSelector = 'input[role="switch"]';
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '深色外观');
  const before = await page.evaluate(selector => document.querySelector(selector).checked, switchSelector);
  assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
  await remote(23);
  assert.equal(await page.evaluate(selector => document.querySelector(selector).checked, switchSelector), !before);
  assert.equal((await page.evaluate(() => window.hub.bootstrap())).preferences.theme, before ? 'light' : 'dark');
  await writeFile(`${output}/settings.png`, await command(['exec-out', 'screencap', '-p']));
  await remote(4);
  await page.wait(() => !document.querySelector('[role="dialog"]'));
  checks.push('native menu / down / center / back, visible focus and persisted setting');
  await focus('input[aria-label="搜索视频"]');
  await remote(23);
  await page.wait(() => document.querySelector('.screen-keyboard'));
  await focus('[data-keyboard-start]');
  await remote(23);
  assert.equal(await page.evaluate(() => document.querySelector('[data-screen-keyboard]').dataset.composing), 'true');
  await remote(4);
  assert.equal(await page.evaluate(() => document.querySelector('[data-screen-keyboard]').dataset.composing), 'false');
  await remote(4);
  await page.wait(() => !document.querySelector('[role="dialog"]'));
  checks.push('pinyin keyboard confirm / cancel and restored modal scope with inert polyfill');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === '打开链接').click());
  await page.wait(() => document.querySelector('.url-form input'));
  await page.evaluate(url => {
    const input = document.querySelector('.url-form input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, url);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, mediaUrl);
  await page.wait(url => document.querySelector('.url-form input').value === url, mediaUrl);
  await focus('.url-form button');
  await remote(23);
  await page.wait(() => {
    const video = document.querySelector('video');
    return video && video.videoWidth > 0 && video.webkitDecodedFrameCount > 0;
  }, undefined, 30000);
  const playback = await page.evaluate(() => {
    const video = document.querySelector('video');
    return { width: video.videoWidth, frames: video.webkitDecodedFrameCount, duration: video.duration, url: video.currentSrc };
  });
  assert.ok(playback.url.startsWith('https://app.yingji.local/media/'));
  assert.ok(requests.length && requests.every(request => !request.cookie));
  assert.equal(await page.evaluate(() => document.querySelector('.player-overlay h2').tabIndex), -1);
  assert.equal(await page.evaluate(() => document.querySelector('.brand').tabIndex), -1);
  await focus('.player-buttons [data-focus-default]');
  await remote(23);
  await page.wait(() => document.querySelector('video').paused);
  await focus('.timeline');
  await remote(22);
  assert.equal(await page.evaluate(() => document.querySelector('.player').dataset.seeking), 'true');
  await remote(4);
  assert.equal(await page.evaluate(() => document.querySelector('.player').dataset.seeking), 'false');
  await focus('.timeline');
  await remote(22);
  await remote(23);
  const target = Math.min(10, playback.duration);
  await page.wait(target => document.querySelector('video').currentTime >= target - .05, target);
  await writeFile(`${output}/player.png`, await command(['exec-out', 'screencap', '-p']));
  await remote(4);
  await remote(4);
  await page.wait(() => !document.querySelector('.player'));
  const history = (await page.evaluate(() => window.hub.bootstrap())).history;
  assert.ok(history.some(entry => entry.item.url === mediaUrl && entry.position >= target - .05));
  checks.push('real MP4 decoding, native Range without cookies, nonfocusable titles, pause / preview / cancel / commit / exit / history');
  const encrypted = await backend.evaluate(() => {
    const error = window.Backend.write('account', JSON.stringify({ marker: 'synthetic-legacy-test' }));
    const roundTrip = window.Backend.read('account');
    window.Backend.write('account', '{}');
    return { error, roundTrip, secure: window.Backend.secure() };
  });
  assert.equal(encrypted.secure, true);
  assert.equal(encrypted.error, '');
  assert.equal(JSON.parse(encrypted.roundTrip).marker, 'synthetic-legacy-test');
  checks.push('Keystore encrypted synthetic storage round trip');
  assert.deepEqual(pages.flatMap(page => page.errors), []);
  const report = { passed: true, serial, android: '9 / API 28', webview: '66.0.3359.158', samplePath, checks, playback, requests };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await writeFile(`${output}/home.png`, await command(['exec-out', 'screencap', '-p']));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(`${output}/failure.png`, await command(['exec-out', 'screencap', '-p']));
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: error.message, checks, requests, errors: pages.flatMap(page => page.errors) }, null, 2));
  throw error;
} finally {
  await connection.close();
  await new Promise(resolve => server.close(resolve));
}
