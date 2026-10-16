import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const output = '.tmp/android-codec-diagnostic';
await mkdir(output, { recursive: true });
const connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
const backend = connection.pages.find(page => page.url.includes('/backend/'));
const page = connection.pages.find(page => !page.url.includes('/backend/'));
const report = { passed: false };
try {
  await page.wait(() => window.hub && document.querySelector('.global-search'));
  const boot = await page.evaluate(() => window.hub.bootstrap());
  assert.ok(!boot.account.web && !boot.account.app, 'Only anonymous isolated emulators are allowed');
  report.version = boot.version;
  report.webview = (await connection.command(['shell', 'dumpsys', 'webviewupdate'])).toString()
    .match(/66\.0\.3359\.158/)?.[0];
  assert.equal(report.webview, '66.0.3359.158');
  // Exact codecs/dimensions from the authorized metadata audit, no account or media samples.
  const bundle = await build({ stdin: { contents: `
    import { androidVideoSupport } from './android/backend/video-support';
    import { buildDashManifest } from './electron/playback/dash';
    const codecs = ['avc1.640033', 'hvc1.1.6.L153.90', 'av01.0.12M.08.0.110.01.01.01.0'];
    const tracks = codecs.map(codecs => ({ id: 120, codecs, width: 3840, height: 2160,
      frameRate: '30', bandwidth: 1, baseUrl: 'https://fixture.invalid/media',
      SegmentBase: { Initialization: '0-99', indexRange: '100-199' } }));
    window.codecProbe = tracks.map(track => ({ codec: track.codecs,
      score: androidVideoSupport(track), ...androidVideoSupport.inspect(track) }));
    const result = buildDashManifest({ duration: 10, video: tracks }, () => 'fixture', 120, androidVideoSupport);
    window.manifestProbe = { quality: result.quality, codec: result.codec, capabilities: result.capabilities };
    `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true,
    platform: 'browser', target: 'chrome66', format: 'iife', write: false });
  const evaluated = await backend.send('Runtime.evaluate', { expression: bundle.outputFiles[0].text });
  assert.ok(!evaluated.exceptionDetails);
  report.capabilities = await backend.evaluate(() => {
    const facts = window.codecProbe;
    delete window.codecProbe;
    return facts;
  });
  for (const fact of report.capabilities) {
    assert.ok([0, 1, 2].includes(fact.decoder));
    assert.equal(fact.score, fact.mse ? fact.decoder : 0);
  }
  report.source = await backend.evaluate(() => {
    const source = window.manifestProbe;
    delete window.manifestProbe;
    return source;
  });
  assert.equal(report.source.quality, 120);
  assert.ok(report.source.capabilities.length > 0);
  assert.ok(report.source.capabilities.some(fact => fact.codec === report.source.codec));
  assert.ok(report.source.capabilities.every(fact => typeof fact.mse === 'boolean' && [0, 1, 2].includes(fact.decoder)));
  report.passed = true;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await connection.close();
  console.log(JSON.stringify(report, null, 2));
}
