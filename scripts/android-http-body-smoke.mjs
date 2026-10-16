import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync, deflateSync, deflateRawSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const xml = '<i><d p="1,1,25,16777215,0,0,h,1">测试弹幕</d></i>';
const body = Buffer.from(xml);
const fixtures = { gzip: gzipSync(body), zlib: deflateSync(body), raw: deflateRawSync(body),
  bomb: gzipSync(Buffer.alloc(4 * 1024 * 1024 + 1, 65)), corrupt: Buffer.from([1, 2, 3]) };
const media = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251));
const ranges = [];
const server = createServer((request, response) => {
  if (request.url === '/media') {
    ranges.push({ range: request.headers.range, cookie: !!request.headers.cookie });
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : media.length - 1;
    response.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
      ...(match ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) });
    response.end(media.subarray(start, end + 1));
  } else {
    const name = request.url.slice(1);
    const bytes = fixtures[name];
    response.writeHead(200, { 'Content-Type': 'text/xml', 'Content-Length': bytes.length,
      'Content-Encoding': ['gzip', 'bomb', 'corrupt'].includes(name) ? 'gzip' : 'deflate' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://10.0.2.2:${server.address().port}`;
const connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
const backend = connection.pages.find(page => page.url.includes('/backend/'));
const page = connection.pages.find(page => !page.url.includes('/backend/'));
const checks = [];
let session;
try {
  await backend.wait(() => typeof window.backendCall === 'function');
  await page.wait(() => !!window.hub);
  for (const name of ['gzip', 'zlib', 'raw']) {
    const result = await backend.evaluate(async url => {
      const response = await window.fetch(url);
      return { text: await response.text(), encoding: response.headers.get('content-encoding'),
        length: response.headers.get('content-length') };
    }, `${origin}/${name}`);
    assert.equal(result.text, xml);
    assert.equal(result.encoding, null);
    assert.equal(result.length, null);
    checks.push(`${name} decoded with wire encoding/length removed`);
  }
  for (const name of ['bomb', 'corrupt']) {
    const failed = await backend.evaluate(async url => {
      try { await window.fetch(url); return false; } catch { return true; }
    }, `${origin}/${name}`);
    assert.ok(failed);
    checks.push(`${name} rejected within decoded body limit`);
  }
  assert.equal(await backend.evaluate(async url => (await window.fetch(url, { method: 'HEAD' })).status, `${origin}/gzip`), 200);
  checks.push('HEAD does not attempt to decompress an absent body');
  const registered = await backend.evaluate(url => {
    const session = crypto.randomUUID();
    const address = window.Backend.register(JSON.stringify({ session, url }));
    return { session, address };
  }, `${origin}/media`);
  session = registered.session;
  const response = await page.evaluate(async address => {
    const response = await fetch(`${address}?range=917-1712`);
    return { status: response.status, range: response.headers.get('content-range'),
      length: response.headers.get('content-length'), bytes: [...new Uint8Array(await response.arrayBuffer())] };
  }, registered.address);
  assert.equal(response.status, 206);
  assert.equal(response.range, 'bytes 917-1712/4096');
  assert.ok(response.length.split(',').every(length => Number(length) === 796));
  assert.deepEqual(response.bytes, [...media.subarray(917, 1713)]);
  assert.deepEqual(ranges, [{ range: 'bytes=917-1712', cookie: false }]);
  assert.equal(await page.evaluate(async address => (await fetch(`${address}?range=invalid`)).status, registered.address), 416);
  assert.equal(ranges.length, 1);
  assert.equal(await page.evaluate(async address => (await fetch(`${address}?range=1-2&range=3-4`)).status, registered.address), 416);
  assert.equal(ranges.length, 1);
  checks.push('nonzero DASH index byte range preserved exactly once; malformed range rejected without upstream request');
  await mkdir('.tmp/android-http-body', { recursive: true });
  const report = { passed: true, checks, range: { status: response.status, length: response.bytes.length, header: response.range } };
  await writeFile('.tmp/android-http-body/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (session) await backend.evaluate(session => window.Backend.release(session), session);
  await connection.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
