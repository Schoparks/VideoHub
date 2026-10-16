import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const serial = process.env.YINGJI_ANDROID_SERIAL;
const label = serial ? 'android66' : 'desktop';
const output = '.tmp/danmaku-renderer-smoke';
await mkdir(output, { recursive: true });
const bundle = await build({ entryPoints: ['src/visual/danmaku-renderer.ts'], bundle: true,
  write: false, format: 'iife', globalName: 'danmakuTest', target: 'chrome66' });
const connection = serial ? await connectLegacyWebViews(serial) : undefined;
const renderer = serial ? undefined
  : await launchHeadlessRenderer({ width: 1920, height: 1080 }, installReliabilityFixture);
const page = connection?.pages.find(page => !page.url.includes('/backend/')) || renderer.page;
const wait = async (fn, timeout = 15000) => {
  if (connection) return page.wait(fn, undefined, timeout);
  return page.waitForFunction(fn, undefined, { timeout });
};
const report = { checks: [], passed: false, label };
try {
  if (connection) await page.send('Runtime.evaluate', { expression: bundle.outputFiles[0].text });
  else await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'danmaku-layer';
    host.style.cssText = 'position:fixed;inset:0;width:1920px;height:1080px;font-size:25px;z-index:999';
    document.body.append(host);
    const video = { currentTime: 2 };
    const comments = [
      { id: 'a', time: 1, mode: 1, text: '<img>安全文本', color: '#ffffff' },
      { id: 'b', time: 1, mode: 6, text: '反向弹幕', color: '#ff0000' },
      { id: 'c', time: 1, mode: 5, text: '固定弹幕', color: '#ffffff' },
      { id: 'd', time: 100, mode: 4, text: '晚到弹幕', color: '#ffffff' },
    ];
    window.dm = { host, video, comments,
      stop: window.danmakuTest.startDanmakuRenderer(host, video, comments, 1920, 1080, 25, .5) };
  });
  await wait(() => window.dm.host.children.length === 3);
  report.checks.push('normal, reverse and fixed comments appear as safe text');
  assert.equal(await page.evaluate(() => window.dm.host.querySelectorAll('img').length), 0);
  const original = await page.evaluate(() => {
    window.dm.node = window.dm.host.firstChild;
    window.dm.previous = window.dm.node.style.transform;
    return window.dm.node.style.transform;
  });
  await page.evaluate(() => { window.dm.video.currentTime = 3; });
  await wait(() => window.dm.node.style.transform !== window.dm.previous);
  const moved = await page.evaluate(() => ({ same: window.dm.node === window.dm.host.firstChild,
    transform: window.dm.node.style.transform }));
  assert.ok(moved.same && moved.transform !== original);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
  assert.equal(await page.evaluate(() => window.dm.node.style.transform), moved.transform);
  report.checks.push('animation reuses spans; unchanged media time freezes position');
  await page.evaluate(() => { window.dm.video.currentTime = 101; });
  await wait(() => window.dm.host.textContent === '晚到弹幕');
  await page.evaluate(() => { window.dm.video.currentTime = 2; });
  await wait(() => window.dm.host.children.length === 3);
  report.checks.push('forward and backward seeks select the correct comments without stale entries');
  await page.evaluate(() => {
    window.dm.stop();
    const original = CanvasRenderingContext2D.prototype.measureText;
    window.dm.originalMeasure = original;
    window.dm.measured = 0;
    CanvasRenderingContext2D.prototype.measureText = function (text) {
      window.dm.measured++;
      const deadline = performance.now() + .03;
      while (performance.now() < deadline) { /* Simulate a slower TV font measurement. */ }
      return original.call(this, text);
    };
    const comments = Array.from({ length: 20000 }, (_, i) => ({
      id: String(i), time: i * .36, mode: 1, text: `电影弹幕${i}`, color: '#ffffff',
    }));
    window.dm.video.currentTime = 7200;
    window.dm.stop = window.danmakuTest.startDanmakuRenderer(window.dm.host,
      window.dm.video, comments, 1920, 1080, 25, .5);
    requestAnimationFrame(() => { window.dm.measuredBeforeInput = window.dm.measured; });
  });
  await wait(() => window.dm.measuredBeforeInput !== undefined);
  report.beforeInput = await page.evaluate(() => window.dm.measuredBeforeInput);
  assert.ok(report.beforeInput > 0 && report.beforeInput <= 80);
  await wait(() => window.dm.host.textContent.includes('电影弹幕19999'), 30000);
  report.pool = await page.evaluate(() => ({ measured: window.dm.measured,
    visible: window.dm.host.children.length }));
  assert.ok(report.pool.measured < 300 && report.pool.visible < 100);
  report.checks.push('a two-hour seek measures only nearby comments and yields within 80 entries per frame');
  await page.evaluate(() => { window.dm.video.currentTime = 3600; });
  await wait(() => window.dm.host.textContent.includes('电影弹幕9999'));
  assert.ok(await page.evaluate(() => window.dm.measured < 600));
  report.checks.push('backward seek rebuilds a bounded window without measuring the first hour');
  await page.evaluate(() => {
    window.dm.stop();
    CanvasRenderingContext2D.prototype.measureText = window.dm.originalMeasure;
  });
  assert.equal(await page.evaluate(() => window.dm.host.children.length), 0);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
  assert.equal(await page.evaluate(() => window.dm.host.children.length), 0);
  report.checks.push('cleanup removes spans and cancels all late layout/animation work');
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(() => {
    window.dm?.stop();
    if (window.dm?.originalMeasure) CanvasRenderingContext2D.prototype.measureText = window.dm.originalMeasure;
    window.dm?.host.remove();
  });
  await writeFile(`${output}/${label}.json`, JSON.stringify(report, null, 2));
  await connection?.close();
  await renderer?.close();
}
