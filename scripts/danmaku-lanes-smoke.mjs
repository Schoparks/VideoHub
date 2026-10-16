import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const serial = process.env.YINGJI_ANDROID_SERIAL;
const label = serial ? 'android66' : 'desktop';
const bundle = await build({ stdin: { contents:
  "export {startDanmakuRenderer} from './src/visual/danmaku-renderer'; export {layoutDanmaku} from './src/shared/danmaku-layout';",
  resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false,
  format: 'iife', globalName: 'laneTest', target: 'chrome66' });
const css = await readFile('src/styles/danmaku.css', 'utf8');
const connection = serial ? await connectLegacyWebViews(serial) : undefined;
const renderer = serial ? undefined : await launchHeadlessRenderer({ width: 1920, height: 1080 }, () => {});
const page = connection?.pages.find(page => !page.url.includes('/backend/')) || renderer.page;
const report = { label, checks: [], passed: false };
try {
  if (connection) await page.send('Runtime.evaluate', { expression: bundle.outputFiles[0].text });
  else await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(css => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const host = document.createElement('div');
    host.className = 'danmaku-layer';
    host.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;font-size:25px;z-index:9999;--danmaku-opacity:.7';
    document.body.append(host);
    const video = new EventTarget();
    Object.assign(video, { currentTime: 2, paused: true, seeking: false, readyState: 4, playbackRate: 1 });
    const comments = Array.from({ length: 900 }, (_, i) => ({ id: String(i), text: `弹幕${i}`,
      time: i / 30, mode: i % 7 === 0 ? 6 : i % 11 === 0 ? 5 : i % 13 === 0 ? 4 : 1, color: '#fff' }));
    const context = document.createElement('canvas').getContext('2d');
    context.font = '600 25px "Microsoft YaHei", sans-serif';
    const expected = laneTest.layoutDanmaku(comments, 1920, 1080, 25, .5, text => context.measureText(text).width);
    window.lanes = { host, video, style, expected,
      stop: laneTest.startDanmakuRenderer(host, video, comments, 1920, 1080, 25, .5) };
  }, css);
  const settle = () => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 800)));
  for (const time of [2, 5, 8, 11, 14, 17, 12, 3, 29]) {
    await page.evaluate(time => {
      window.lanes.video.currentTime = time;
      window.lanes.video.dispatchEvent(new Event('seeked'));
    }, time);
    await settle();
    const measured = await page.evaluate(() => {
      const { host, expected, video } = window.lanes;
      const visible = expected.filter(comment => comment.time <= video.currentTime && comment.end > video.currentTime);
      const nodes = [...host.querySelectorAll('span')];
      let maxError = 0;
      for (const comment of visible) {
        const node = nodes.find(node => node.textContent === comment.text);
        if (!node) return { missing: comment.id };
        const elapsed = video.currentTime - comment.time;
        const x = comment.mode === 1 ? 1920 - elapsed * comment.speed
          : comment.mode === 6 ? -comment.width + elapsed * comment.speed : (1920 - comment.width) / 2;
        const bounds = node.getBoundingClientRect();
        maxError = Math.max(maxError, Math.abs(bounds.left - x), Math.abs(bounds.top - comment.y));
      }
      return { maxError, expected: visible.length, actual: nodes.length,
        groups: host.querySelectorAll('.danmaku-lane').length, hostAlpha: getComputedStyle(host).opacity };
    });
    assert.equal(measured.missing, undefined, `missing text at ${time}s`);
    assert.equal(measured.actual, measured.expected);
    assert.ok(measured.maxError < 1, `position drift at ${time}s: ${measured.maxError}`);
    assert.ok(measured.groups <= 14);
    assert.equal(measured.hostAlpha, '1');
    report.checks.push({ time, ...measured });
  }
  await page.evaluate(() => {
    const state = window.lanes;
    state.video.currentTime = 3;
    state.video.paused = false;
    state.video.playbackRate = 2;
    state.video.dispatchEvent(new Event('ratechange'));
  });
  await settle();
  const before = await page.evaluate(() => window.lanes.host.querySelector('.danmaku-lane span').getBoundingClientRect().left);
  await page.evaluate(() => {
    const deadline = performance.now() + 200;
    while (performance.now() < deadline) { /* No main-thread position update. */ }
  });
  const after = await page.evaluate(() => window.lanes.host.querySelector('.danmaku-lane span').getBoundingClientRect().left);
  assert.ok(Math.abs(before - after) > 60, 'lane compositor must move at 2x while JS is occupied');
  report.checks.push('2x shared animation moves while main thread is occupied');
  await page.evaluate(() => window.lanes.stop());
  assert.equal(await page.evaluate(() => window.lanes.host.children.length), 0);
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(() => {
    window.lanes?.stop();
    window.lanes?.host.remove();
    window.lanes?.style.remove();
  });
  await mkdir('.tmp/danmaku-lanes-smoke', { recursive: true });
  await writeFile(`.tmp/danmaku-lanes-smoke/${label}.json`, JSON.stringify(report, null, 2));
  await connection?.close();
  await renderer?.close();
}
