import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const serial = process.env.YINGJI_ANDROID_SERIAL;
const label = serial ? 'android66' : 'desktop';
const bundle = await build({ entryPoints: ['src/visual/danmaku-motion.ts'], bundle: true,
  write: false, format: 'iife', globalName: 'motionTest', target: 'chrome66' });
const connection = serial ? await connectLegacyWebViews(serial) : undefined;
const renderer = serial ? undefined
  : await launchHeadlessRenderer({ width: 1920, height: 1080 }, installReliabilityFixture);
const page = connection?.pages.find(page => !page.url.includes('/backend/')) || renderer.page;
const report = { label, passed: false, checks: [] };
const wait = ms => page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), ms);
try {
  if (connection) await page.send('Runtime.evaluate', { expression: bundle.outputFiles[0].text });
  else await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const node = document.createElement('span');
    node.textContent = '平滑弹幕';
    node.style.cssText = 'position:fixed;top:0;left:0;will-change:transform;z-index:999';
    document.body.append(node);
    const video = { currentTime: 2, paused: false, seeking: false, readyState: 4, playbackRate: 1 };
    const comment = { id: 'test', text: '平滑弹幕', color: '#ffffff', mode: 1,
      time: 1, end: 10, width: 240, y: 12, speed: 240 };
    const motion = window.motionTest.createDanmakuMotion(node, comment, 1920, video);
    motion.update(2);
    window.dmMotion = { node, video, motion,
      x: () => {
        const transform = getComputedStyle(node).transform;
        const values = transform.slice(transform.indexOf('(') + 1, -1).split(',').map(Number);
        return values[transform.startsWith('matrix3d') ? 12 : 4];
      } };
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await wait(80);
  const before = await page.evaluate(() => window.dmMotion.x());
  await page.evaluate(() => {
    const end = performance.now() + 200;
    while (performance.now() < end) { /* Hold the JS thread; no motion update runs. */ }
  });
  const after = await page.evaluate(() => window.dmMotion.x());
  report.motion = await page.evaluate(() => ({
    ready: HTMLMediaElement.HAVE_FUTURE_DATA, timeline: document.timeline?.currentTime,
    animations: window.dmMotion.node.getAnimations?.().map(animation => ({
      currentTime: animation.currentTime, pending: animation.pending, playState: animation.playState,
    })),
  }));
  assert.ok(before - after > 25, `compositor did not advance: ${before} -> ${after}`);
  report.checks.push('scrolling advances while JavaScript is occupied without per-frame style writes');
  await page.evaluate(() => {
    window.dmMotion.video.paused = true;
    window.dmMotion.motion.update(2.4);
  });
  await wait(80);
  const paused = await page.evaluate(() => window.dmMotion.x());
  assert.ok(Math.abs(paused - 1584) < 1);
  await wait(150);
  assert.equal(await page.evaluate(() => window.dmMotion.x()), paused);
  report.checks.push('pause re-anchors at the exact media time and freezes the compositor');
  await page.evaluate(() => {
    window.dmMotion.video.paused = false;
    window.dmMotion.video.playbackRate = 2;
    window.dmMotion.motion.update(2.4);
  });
  await wait(200);
  const accelerated = await page.evaluate(() => window.dmMotion.x());
  assert.ok(paused - accelerated > 60 && paused - accelerated < 160);
  await page.evaluate(() => {
    window.dmMotion.video.paused = true;
    window.dmMotion.motion.update(1.5);
  });
  await wait(80);
  assert.ok(Math.abs(await page.evaluate(() => window.dmMotion.x()) - 1800) < 1);
  report.checks.push('2x playback changes animation speed; backward seek restores the correct position');
  await page.evaluate(() => {
    window.dmMotion.video.paused = false;
    window.dmMotion.video.readyState = 2;
    window.dmMotion.motion.update(2);
  });
  await wait(80);
  const buffered = await page.evaluate(() => window.dmMotion.x());
  await wait(150);
  assert.equal(await page.evaluate(() => window.dmMotion.x()), buffered);
  report.checks.push('buffering freezes scrolling rather than running ahead of the video');
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(() => { window.dmMotion?.motion.stop(); window.dmMotion?.node.remove(); });
  await mkdir('.tmp/danmaku-motion-smoke', { recursive: true });
  await writeFile(`.tmp/danmaku-motion-smoke/${label}.json`, JSON.stringify(report, null, 2));
  await connection?.close();
  await renderer?.close();
}
