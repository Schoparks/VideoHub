import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const bvid = process.env.YINGJI_ANDROID_BVID;
if (!/^BV[a-zA-Z0-9]{10}$/.test(bvid || '')) throw new Error('Specify a public multipart BV id');
const connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
const page = connection.pages.find(p => !p.url.includes('/backend/'));
const backend = connection.pages.find(p => p.url.includes('/backend/'));
const report = { bvid, parts: [], passed: false };
const output = '.tmp/android-multipart';
await mkdir(output, { recursive: true });
try {
  await page.wait(() => window.hub && document.querySelector('.global-search'));
  report.boot = await page.evaluate(async () => {
    const boot = await window.hub.bootstrap();
    return { web: boot.account.web, app: boot.account.app, version: boot.version };
  });
  assert.ok(!report.boot.web && !report.boot.app, 'Only anonymous isolated emulators are allowed');
  report.capabilities = await backend.evaluate(() => {
    const variants = ['avc1.64001E', 'avc1.640033', 'hev1.1.6.L153.B0', 'av01.0.12M.08'];
    return variants.map(codec => ({ codec, mse: MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`),
      native: window.Backend.videoSupport(JSON.stringify({ codec, width: 3840, height: 2160, frameRate: '30' })) }));
  });
  assert.ok(report.capabilities.every(value => [0, 1, 2].includes(value.native)));
  assert.equal(await backend.evaluate(() => window.Backend.videoSupport('{}')), 0);
  report.avc480Support = await backend.evaluate(() => window.Backend.videoSupport(JSON.stringify({
    codec: 'avc1.64001E', width: 640, height: 480, frameRate: '25',
  })));
  if (await page.evaluate(() => !!document.querySelector('.player'))) {
    await page.evaluate(() => document.querySelector('[data-player-leave]').click());
    await page.wait(() => !document.querySelector('.player'));
  }
  // Record only finite source metadata, never media addresses, headers, or account material.
  await page.evaluate(() => {
    window.multipartSources = [];
    const resolve = window.hub.resolve;
    window.originalMultipartResolve = resolve;
    window.hub.resolve = async (...args) => {
      const source = await resolve(...args);
      window.multipartSources.push({ cid: source.part?.cid, title: source.part?.title,
        quality: source.quality, codec: source.videoCodec });
      return source;
    };
  });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '打开链接').click());
  await page.wait(() => document.querySelector('.url-form input'));
  await page.evaluate(bvid => {
    const input = document.querySelector('.url-form input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, bvid);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, bvid);
  await page.evaluate(() => document.querySelector('.url-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.wait(() => document.querySelector('video'), undefined, 45000);
  for (let part = 0; part < 3; part++) {
    await page.wait(() => document.querySelector('video')?.webkitDecodedFrameCount > 20
      || document.querySelector('.player-error'), undefined, 45000);
    const start = await page.evaluate(() => document.querySelector('video').currentTime);
    await page.wait(start => document.querySelector('video').currentTime > start + 2, start, 30000);
    const state = await page.evaluate(() => {
      const video = document.querySelector('video');
      const state = { time: video.currentTime, duration: video.duration, frames: video.webkitDecodedFrameCount,
        audio: video.webkitAudioDecodedByteCount, error: video.error?.code,
        fresh: !window.previousMultipartVideo || window.previousMultipartVideo !== video,
        elements: document.querySelectorAll('video').length };
      window.previousMultipartVideo = video;
      return state;
    });
    report.parts.push({ part: part + 1, ...state });
    assert.ok(state.fresh && state.elements === 1 && state.frames > 20 && state.audio > 0 && !state.error);
    if (part < 2) {
      await page.evaluate(() => document.querySelector('.episode-toggle').click());
      await page.wait(() => document.querySelector('.episode-panel'));
      await page.evaluate(index => document.querySelectorAll('.episode-option')[index].click(), part + 1);
      await page.wait(count => window.multipartSources.length === count
        && document.querySelector('video') !== window.previousMultipartVideo, part + 2, 45000);
    }
  }
  report.sources = await page.evaluate(() => window.multipartSources);
  assert.equal(new Set(report.sources.map(source => source.cid)).size, 3);
  assert.ok(report.sources.every(source => source.codec));
  await page.evaluate(() => document.querySelector('[data-player-leave]').click());
  await page.wait(() => !document.querySelector('.player'));
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(() => {
    if (window.originalMultipartResolve) window.hub.resolve = window.originalMultipartResolve;
    delete window.originalMultipartResolve;
    delete window.previousMultipartVideo;
    delete window.multipartSources;
  });
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await connection.close();
}
