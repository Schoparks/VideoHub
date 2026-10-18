import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';
import { phoneMediaFixture } from './phone-media-fixture.mjs';

const serial = process.env.YINGJI_ANDROID_SERIAL;
const output = '.tmp/android-phone-controller';
await mkdir(output, { recursive: true });
const connection = await connectLegacyWebViews(serial);
const { command, pages } = connection;
const ui = pages.find(page => page.url.endsWith('/index.html') && !page.url.includes('/backend/'));
assert.ok(ui);
const sample = await phoneMediaFixture();
const mediaRequests = [];
const media = createServer((request, response) => {
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(sample.length - 1, Number(range[2])) : sample.length - 1;
  mediaRequests.push({ range: !!range, cookie: !!request.headers.cookie });
  response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${sample.length}` } : {}) });
  response.end(sample.subarray(start, end + 1));
});
await new Promise(resolve => media.listen(0, '127.0.0.1', resolve));
let port, browser;
const checks = [];
try {
  const provider = (await command(['shell', 'dumpsys', 'webviewupdate'])).toString();
  assert.match(provider, /66\.0\.3359\.158/);
  await ui.wait(() => window.hub && document.querySelector('.nav-item'));
  const boot = await ui.evaluate(() => window.hub.bootstrap());
  assert.equal(boot.account.app, false);
  assert.equal(boot.account.web, false);
  // Search uses an isolated response, never the user's account or external recommendation service.
  await ui.evaluate(() => {
    window.phoneSearches = [];
    window.hub.browse = async request => { window.phoneSearches.push(request); return { items: [], hasMore: false }; };
    document.querySelector('.topbar button[aria-label="设置"]').click();
  });
  await ui.wait(() => document.querySelector('.settings-tabs'));
  assert.equal(await ui.evaluate(() => document.querySelectorAll('.global-search button').length), 0);
  const columnCheck = await ui.evaluate(() => {
    const select = document.querySelector('select[aria-label="卡片大小"]');
    select.focus();
    const before = select.value;
    const step = select.selectedIndex === select.options.length - 1 ? -1 : 1;
    const expected = select.options[select.selectedIndex + step].value;
    window.dispatchEvent(new CustomEvent('hub-remote', { detail: 'right' }));
    return { before, after: select.value, expected, action: step > 0 ? 'right' : 'left' };
  });
  assert.equal(columnCheck.before, columnCheck.after);
  await ui.evaluate(() => window.dispatchEvent(new CustomEvent('hub-remote', { detail: 'confirm' })));
  await ui.evaluate(action => window.dispatchEvent(new CustomEvent('hub-remote', { detail: action })), columnCheck.action);
  assert.equal(await ui.evaluate(() => document.querySelector('select[aria-label="卡片大小"]').value), columnCheck.expected);
  await ui.evaluate(() => window.dispatchEvent(new CustomEvent('hub-remote', { detail: 'confirm' })));
  assert.equal(await ui.evaluate(() => document.querySelector('select[aria-label="卡片大小"]').hasAttribute('data-setting-editing')), false);
  checks.push('single topbar search focus and explicit setting edit mode on WebView66');
  await ui.evaluate(() => Array.from(document.querySelectorAll('[role="tab"]')).find(node => node.textContent === '手机遥控').click());
  await ui.wait(() => document.querySelector('img[alt="手机遥控二维码"]'));
  const state = await ui.evaluate(() => window.hub.controllerStatus());
  assert.equal(state.enabled, true);
  const target = new URL(state.urls[0]);
  const token = target.hash.slice(1);
  port = target.port;
  await command(['forward', `tcp:${port}`, `tcp:${port}`]);
  const address = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${address}/state`)).status, 401);
  assert.equal((await fetch(`${address}/state`, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' } })).status, 403);
  browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phoneErrors = [];
  phone.on('pageerror', error => phoneErrors.push(error.message));
  await phone.goto(`${address}/#${token}`);
  await phone.getByText('在线', { exact: true }).waitFor();
  checks.push('WebView66 native server and bundled phone page; authorization and cross-origin rejection');
  await phone.getByRole('button', { name: '返回', exact: true }).tap();
  await ui.wait(() => !document.querySelector('[role="dialog"]'));
  await phone.getByRole('button', { name: '搜索', exact: true }).tap();
  await phone.getByRole('searchbox', { name: '搜索关键词', exact: true }).fill('安卓手机搜索');
  await phone.getByRole('button', { name: '在屏幕上搜索', exact: true }).tap();
  await ui.wait(() => window.phoneSearches.some(request => request.keyword === '安卓手机搜索'));
  checks.push('phone Chinese search reaches existing Android browse flow');
  await phone.getByRole('button', { name: '链接', exact: true }).tap();
  await phone.getByRole('textbox', { name: '视频地址或 BV 号', exact: true }).fill(`http://10.0.2.2:${media.address().port}/fixture.mp4`);
  await phone.getByRole('button', { name: '打开视频', exact: true }).tap();
  await ui.wait(() => document.querySelector('video')?.videoWidth > 0 && document.querySelector('video').currentTime > .2, undefined, 25000);
  await phone.getByText('视频已打开', { exact: true }).waitFor();
  await phone.getByRole('button', { name: '播放 / 暂停', exact: true }).tap();
  await ui.wait(() => document.querySelector('video')?.paused === true);
  checks.push('phone URL opens real local MP4 through native gateway; pause works');
  assert.ok(mediaRequests.length);
  assert.ok(mediaRequests.every(request => !request.cookie));
  await writeFile(`${output}/tv.png`, await command(['exec-out', 'screencap', '-p']));
  await phone.screenshot({ path: `${output}/phone.png`, fullPage: true });
  // Background commands fail immediately; the same pairing survives a return to the app.
  await command(['shell', 'input', 'keyevent', '3']);
  assert.equal((await fetch(`${address}/state`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  const blocked = await fetch(`${address}/command`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'action', action: 'menu' }) });
  assert.deepEqual(await blocked.json(), { error: 'unavailable' });
  await command(['shell', 'am', 'start', '-n', 'app.yingji.tv/.MainActivity']);
  await ui.wait(() => !document.hidden);
  assert.deepEqual(await ui.evaluate(() => window.hub.controllerStatus()), state);
  await phone.getByRole('button', { name: '播放 / 暂停', exact: true }).tap();
  await ui.wait(() => document.querySelector('video')?.paused === false);
  checks.push('enabled automatically; background rejects commands; same pairing works after resume');
  assert.deepEqual(phoneErrors, []);
  assert.deepEqual(ui.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ serial, webview: '66.0.3359.158', checks, passed: true }, null, 2));
  console.log(JSON.stringify({ checks, passed: true }, null, 2));
} finally {
  await ui.evaluate(() => window.hub.controllerEnable(false)).catch(() => {});
  await browser?.close();
  if (port) await command(['forward', '--remove', `tcp:${port}`]).catch(() => {});
  await connection.close();
  media.closeAllConnections();
  await new Promise(resolve => media.close(resolve));
}
