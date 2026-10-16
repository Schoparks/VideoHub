import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const output = '.tmp/android-network-smoke';
await mkdir(output, { recursive: true });
const pfx = await readFile(`${output}/self-signed.p12`);
const tls = httpsServer({ pfx, passphrase: 'fixture' }, (_request, response) => response.end('fixture'));
const delayed = httpServer((_request, _response) => { /* Exercise actual request cancellation. */ });
for (const server of [tls, delayed]) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
const backend = connection.pages.find(page => page.url.includes('/backend/'));
const report = [];
try {
  await backend.wait(() => typeof window.backendCall === 'function');
  for (const test of [
    // The host network synthesizes A records even for .invalid. An overlong DNS label
    // deterministically reaches Android's resolver rejection rather than that proxy.
    { kind: 'dns', url: `https://${'x'.repeat(64)}.invalid/` },
    { kind: 'tls', url: `https://10.0.2.2:${tls.address().port}/` },
    // Reject inside the emulator; a closed Windows host port may be silently dropped.
    { kind: 'offline', url: 'http://127.0.0.1:1/' },
    { kind: 'timeout', url: `http://10.0.2.2:${delayed.address().port}/`, timeout: 150 },
  ]) {
    const result = await backend.evaluate(async ({ url, timeout }) => {
      try {
        await window.fetch(url, timeout ? { signal: AbortSignal.timeout(timeout) } : {});
        return { success: true };
      } catch (error) { return { name: error.name, kind: error.kind, message: error.message }; }
    }, test);
    assert.equal(result.kind, test.kind);
    assert.equal(result.name, 'ConnectionFailure');
    assert.ok(!result.message.includes(test.url));
    report.push({ expected: test.kind, ...result });
  }
  // A deliberate user cancel must not become a network timeout.
  const canceled = await backend.evaluate(async url => {
    const controller = new AbortController();
    const pending = window.fetch(url, { signal: controller.signal });
    controller.abort();
    try { await pending; return 'completed'; } catch (error) { return error.name; }
  }, `http://10.0.2.2:${delayed.address().port}/`);
  assert.equal(canceled, 'AbortError');
  report.push({ userCancellation: canceled });
  assert.deepEqual(backend.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await connection.close();
  for (const server of [tls, delayed]) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
