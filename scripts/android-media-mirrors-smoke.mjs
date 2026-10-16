import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const media = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251));
const requests = [];
const server = createServer((request, response) => {
  requests.push({ path: request.url, range: request.headers.range,
    cookie: !!request.headers.cookie, referer: request.headers.referer });
  if (request.url === '/unavailable') { response.writeHead(503); response.end(); return; }
  if (request.url === '/denied') { response.writeHead(403); response.end(); return; }
  if (request.url === '/connection') { request.socket.destroy(); return; }
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2] ? Number(match[2]) : media.length - 1;
  response.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
    ...(match ? { 'Content-Range': `bytes ${request.url === '/wrong' ? start + 1 : start}-${end}/${media.length}` } : {}) });
  if (request.url === '/cut' || request.url === '/hold') {
    response.write(media.subarray(start, start + 137));
    if (request.url === '/cut') setTimeout(() => response.destroy(), 50);
  } else response.end(media.subarray(start, end + 1));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://10.0.2.2:${server.address().port}`;
const connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
const backend = connection.pages.find(page => page.url.includes('/backend/'));
const page = connection.pages.find(page => !page.url.includes('/backend/'));
const sessions = [];
const report = { passed: false, checks: [] };
const register = async (path, backup = '/media', bili = true) => {
  const result = await backend.evaluate(({ url, backup, bili }) => {
    const session = crypto.randomUUID();
    return { session, address: window.Backend.register(JSON.stringify({ session, url, backups: [backup], bili })) };
  }, { url: origin + path, backup: origin + backup, bili });
  sessions.push(result.session);
  return result.address;
};
const read = address => page.evaluate(async address => {
  try {
    const response = await fetch(`${address}?range=917-1712`);
    return { status: response.status, range: response.headers.get('content-range'),
      bytes: [...new Uint8Array(await response.arrayBuffer())] };
  } catch { return { failed: true }; }
}, address);
try {
  await backend.wait(() => typeof window.backendCall === 'function');
  assert.ok(await page.evaluate(async () => {
    const { account } = await window.hub.bootstrap();
    return !account.app && !account.web;
  }), 'Use only an anonymous isolated emulator');
  for (const path of ['/unavailable', '/connection', '/cut']) {
    const before = requests.length;
    const result = await read(await register(path));
    assert.equal(result.status, 206);
    assert.equal(result.range, 'bytes 917-1712/4096');
    assert.deepEqual(result.bytes, [...media.subarray(917, 1713)]);
    const actual = requests.slice(before);
    assert.ok(actual.every(request => !request.cookie && request.referer === 'https://www.bilibili.com/'));
    assert.equal(actual.at(-1).path, '/media');
    assert.equal(actual.at(-1).range, path === '/cut' ? 'bytes=1054-1712' : 'bytes=917-1712');
    report.checks.push(`${path}: exact byte recovery from registered mirror, no account cookies`);
  }
  let before = requests.length;
  assert.equal((await read(await register('/denied'))).status, 403);
  assert.deepEqual(requests.slice(before).map(request => request.path), ['/denied']);
  report.checks.push('permission failure preserved without mirror retry');
  before = requests.length;
  assert.equal((await read(await register('/unavailable', '/media', false))).status, 503);
  assert.deepEqual(requests.slice(before).map(request => request.path), ['/unavailable']);
  report.checks.push('user direct links cannot introduce platform mirrors');
  const incorrect = await read(await register('/unavailable', '/wrong'));
  assert.ok(incorrect.failed || incorrect.status === 502);
  report.checks.push('a mismatched mirror range fails instead of appending corrupt bytes');
  const address = await register('/hold');
  before = requests.length;
  const pending = read(address);
  const deadline = Date.now() + 5000;
  while (!requests.slice(before).some(request => request.path === '/hold')) {
    assert.ok(Date.now() < deadline);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await backend.evaluate(session => window.Backend.release(session), sessions.at(-1));
  const canceled = await pending;
  assert.ok(canceled.failed);
  assert.deepEqual(requests.slice(before).map(request => request.path), ['/hold']);
  report.checks.push('session release interrupts an active read and prevents a late mirror connection');
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.message;
  throw error;
} finally {
  for (const session of sessions) await backend.evaluate(session => window.Backend.release(session), session);
  await mkdir('.tmp/android-media-mirrors', { recursive: true });
  await writeFile('.tmp/android-media-mirrors/report.json', JSON.stringify(report, null, 2));
  await connection.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
