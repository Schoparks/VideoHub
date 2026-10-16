import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const output = '.tmp/android-video-startup';
await mkdir(output, { recursive: true });
const connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
const page = connection.pages.find(page => !page.url.includes('/backend/'));
const bvid = process.env.YINGJI_ANDROID_BVID || 'BV1uday6xEW6';
assert.match(bvid, /^BV[0-9A-Za-z]{10}$/);
const report = { bvid, samples: [], passed: false };
try {
  await page.wait(() => window.hub && document.querySelector('.global-search'));
  const account = await page.evaluate(async () => (await window.hub.bootstrap()).account);
  assert.ok(!account.app && !account.web, 'Only use an anonymous isolated emulator');
  if (await page.evaluate(() => !!document.querySelector('.player'))) {
    await page.evaluate(() => document.querySelector('[data-player-leave]').click());
    await page.wait(() => !document.querySelector('.player'));
  }
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(node => node.textContent.trim() === '打开链接').click());
  await page.wait(() => document.querySelector('.url-form input'));
  await page.evaluate(bvid => {
    const input = document.querySelector('.url-form input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, bvid);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, bvid);
  await page.wait(bvid => document.querySelector('.url-form input').value === bvid, bvid);
  await page.evaluate(() => {
    window.__startupTime = performance.now();
    document.querySelector('.url-form button').focus();
  });
  await connection.command(['shell', 'input', 'keyevent', '23']);
  await page.wait(() => document.querySelector('video'), undefined, 30000);
  report.prepareMs = await page.evaluate(() => Math.round(performance.now() - window.__startupTime));
  await page.wait(() => {
    const v = document.querySelector('video');
    return v?.videoWidth > 0 && v.webkitDecodedFrameCount > 0 && v.currentTime > .1;
  }, undefined, 30000);
  report.firstFrameMs = await page.evaluate(() => Math.round(performance.now() - window.__startupTime));
  for (let i = 0; i < 3; i++) {
    const state = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { time: v.currentTime, frames: v.webkitDecodedFrameCount,
        audioBytes: v.webkitAudioDecodedByteCount, width: v.videoWidth,
        ahead: v.buffered.length ? Math.max(0, v.buffered.end(v.buffered.length - 1) - v.currentTime) : 0,
        error: document.querySelector('.player-error')?.textContent };
    });
    report.samples.push(state);
    assert.ok(!state.error && state.frames > 0 && state.audioBytes > 0);
    if (i < 2) await page.wait(time => document.querySelector('video').currentTime > time + 5, state.time);
  }
  assert.ok(report.samples[2].frames > report.samples[0].frames + 50);
  assert.ok(report.samples[2].ahead < 45, 'Long-form Android read-ahead must stay near the 30-second target');
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (await page.evaluate(() => !!document.querySelector('[data-player-leave]'))) {
    await page.evaluate(() => document.querySelector('[data-player-leave]').click());
    await page.wait(() => !document.querySelector('.player'));
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await connection.close();
}
