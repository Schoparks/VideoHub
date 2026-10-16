import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

// Synthetic comments over a real local MP4: do not infer TV hardware performance from this.
const serial = process.env.YINGJI_ANDROID_SERIAL;
const label = serial ? 'android66' : 'desktop';
const output = '.tmp/danmaku-video-smoke';
await mkdir(output, { recursive: true });
const report = { label, passed: false, scenes: [] };
await writeFile(`${output}/${label}.json`, JSON.stringify(report));
const bundle = await build({ entryPoints: ['src/visual/danmaku-renderer.ts'], bundle: true,
  write: false, format: 'iife', globalName: 'videoDanmakuTest', target: 'chrome66' });
const css = await readFile('src/styles/danmaku.css', 'utf8');
const baseline = process.env.YINGJI_DANMAKU_BASELINE
  ? await readFile(process.env.YINGJI_DANMAKU_BASELINE, 'utf8') : '';
const sample = await readFile(process.env.YINGJI_ANDROID_SAMPLE || `${output}/fixture.mp4`);
const connection = serial ? await connectLegacyWebViews(serial) : undefined;
const renderer = serial ? undefined
  : await launchHeadlessRenderer({ width: 1920, height: 1080 }, () => {});
const page = connection?.pages.find(page => !page.url.includes('/backend/')) || renderer.page;
const wait = async fn => connection ? page.wait(fn, undefined, 30000)
  : page.waitForFunction(fn, undefined, { timeout: 30000 });
try {
  const script = bundle.outputFiles[0].text + '\n' + baseline;
  if (connection) await page.send('Runtime.evaluate', { expression: script });
  else await page.addScriptTag({ content: script });
  await page.evaluate(({ css, sample }) => {
    const style = document.createElement('style');
    style.textContent = css + '\n.danmaku-layer[data-baseline] span{will-change:transform;opacity:1}';
    document.head.append(style);
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;top:0;left:0;width:1920px;height:1080px;background:#000;z-index:9999';
    const video = document.createElement('video');
    video.style.cssText = 'width:100%;height:100%;object-fit:contain';
    video.muted = true;
    video.loop = true;
    const bytes = Uint8Array.from(atob(sample), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    video.src = url;
    const host = document.createElement('div');
    host.className = 'danmaku-layer';
    host.style.cssText = 'left:0;top:0;width:1920px;height:1080px;font-size:25px;--danmaku-opacity:.7';
    stage.append(video, host);
    document.body.append(stage);
    const comments = Array.from({ length: 9000 }, (_, i) => ({
      id: String(i), time: i / 30, mode: 1, text: `电影弹幕流畅度验证${i}`, color: '#ffffff',
    }));
    window.dmVideo = { stage, style, video, host, url, comments };
    return video.play();
  }, { css, sample: sample.toString('base64') });
  await wait(() => window.dmVideo.video.currentTime > 1);
  report.media = await page.evaluate(() => {
    const video = window.dmVideo.video;
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  });
  const scenes = baseline ? ['off', 'baseline', 'lanes', 'lanes', 'baseline', 'off'] : ['off', 'lanes', 'lanes', 'off'];
  for (const scene of scenes) {
    await page.evaluate(scene => {
      const state = window.dmVideo;
      state.stop?.();
      if (scene === 'baseline') state.host.setAttribute('data-baseline', '');
      else state.host.removeAttribute('data-baseline');
      state.host.style.opacity = scene === 'baseline' ? '.7' : '1';
      state.host.style.setProperty('--danmaku-opacity', scene === 'baseline' ? '1' : '.7');
      state.video.currentTime = 8;
      const renderer = scene === 'baseline' ? window.legacyDanmakuTest : window.videoDanmakuTest;
      if (scene !== 'off') state.stop = renderer.startDanmakuRenderer(state.host,
        state.video, state.comments, 1920, 1080, 25, .5);
    }, scene);
    await wait(() => !window.dmVideo.video.seeking && window.dmVideo.video.currentTime > 9);
    const measurement = await page.evaluate(() => new Promise(resolve => {
      const state = window.dmVideo;
      const quality = () => ({ frames: state.video.webkitDecodedFrameCount,
        dropped: state.video.webkitDroppedFrameCount });
      const first = quality(), startTime = state.video.currentTime, start = performance.now();
      let previous = start, frame = 0, maxNodes = 0, maxLanes = 0;
      const gaps = [];
      const tick = now => {
        gaps.push(now - previous);
        previous = now;
        maxNodes = Math.max(maxNodes, state.host.querySelectorAll('span').length);
        maxLanes = Math.max(maxLanes, state.host.querySelectorAll('.danmaku-lane').length);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      setTimeout(() => {
        cancelAnimationFrame(frame);
        const last = quality();
        gaps.sort((a, b) => a - b);
        resolve({ elapsed: performance.now() - start, advanced: state.video.currentTime - startTime,
          frames: last.frames - first.frames, dropped: last.dropped - first.dropped,
          rafP95: gaps[Math.floor(gaps.length * .95)], maxNodes, maxLanes,
          paused: state.video.paused, error: state.video.error?.code || 0 });
      }, 4000);
    }));
    report.scenes.push({ scene, ...measurement });
    assert.equal(measurement.error, 0);
    assert.equal(measurement.paused, false);
    assert.ok(measurement.frames > 30 && measurement.advanced > 2, 'real video must keep decoding with comments');
    if (scene !== 'off') assert.ok(measurement.maxNodes > 30, 'exercise a dense overlay');
  }
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(() => {
    const state = window.dmVideo;
    if (!state) return;
    state.stop?.();
    state.video.pause();
    state.video.removeAttribute('src');
    state.video.load();
    URL.revokeObjectURL(state.url);
    state.stage.remove();
    state.style.remove();
    delete window.dmVideo;
  });
  await writeFile(`${output}/${label}.json`, JSON.stringify(report, null, 2));
  await connection?.close();
  await renderer?.close();
}
