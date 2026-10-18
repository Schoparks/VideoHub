import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { phoneMediaFixture } from './phone-media-fixture.mjs';

const output = resolve('.tmp/desktop-phone-controller');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(`${output}/profile-`);
const env = { ...process.env, YINGJI_TEST_DATA: profile, YINGJI_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const sample = await phoneMediaFixture();
const media = createServer((request, response) => {
  assert.equal(request.headers.cookie, undefined);
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), sample.length - 1) : sample.length - 1;
  response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${sample.length}` } : {}) });
  response.end(sample.subarray(start, end + 1));
});
await new Promise(resolveListen => media.listen(0, '127.0.0.1', resolveListen));
const app = await electron.launch({
  ...(process.env.YINGJI_EXECUTABLE ? { executablePath: resolve(process.env.YINGJI_EXECUTABLE), args: [] } : { args: ['.'] }),
  cwd: process.cwd(), env, timeout: 30000,
});
const checks = [];
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false);
  // Simulate foreground document visibility inside the hidden isolated test window only.
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
  const state = await page.evaluate(() => window.hub.controllerStatus());
  assert.equal(state.enabled, true);
  const url = new URL(state.urls[0]);
  const address = `http://127.0.0.1:${url.port}`;
  const headers = { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' };
  const send = async command => {
    const result = await fetch(`${address}/command`, { method: 'POST', headers, body: JSON.stringify(command) });
    return result.json();
  };
  assert.deepEqual(await send({ kind: 'action', action: 'menu' }), {});
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  assert.deepEqual(await send({ kind: 'search', text: 'blocked' }), { error: 'blocked' });
  assert.deepEqual(await send({ kind: 'action', action: 'back' }), {});
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  checks.push('real Electron preload, named IPC, semantic menu/back and blocked search acknowledgment');
  assert.deepEqual(await send({ kind: 'url', text: `http://127.0.0.1:${media.address().port}/fixture.mp4` }), {});
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0 && document.querySelector('video').currentTime > .2);
  assert.deepEqual(await send({ kind: 'action', action: 'pause' }), {});
  await page.waitForFunction(() => document.querySelector('video')?.paused === true);
  checks.push('real local MP4 decode and semantic pause over LAN without media cookies');
  await page.evaluate(() => window.hub.controllerEnable(false));
  assert.equal((await fetch(`${address}/state`, { headers })).status, 200);
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'));
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
  assert.deepEqual(await page.evaluate(() => window.hub.controllerStatus()), state);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false);
  checks.push('enabled at startup; legacy disable and suspend/resume retain connection; test window never shown');
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, passed: true }, null, 2));
  console.log(JSON.stringify({ checks, passed: true }, null, 2));
} finally {
  await app.close();
  media.closeAllConnections();
  await new Promise(resolveClose => media.close(resolveClose));
}
