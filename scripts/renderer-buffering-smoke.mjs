import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-buffering');
await mkdir(output, { recursive: true });
const checks = [];
for (const tvMode of [false, true]) {
  const { page, errors, close } = await launchHeadlessRenderer(tvMode
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const label = tvMode ? 'TV' : 'desktop';
  const emit = (type, ready) => page.locator('video').evaluate((video, data) => {
    window.bufferingAudit.ready = data.ready;
    video.dispatchEvent(new Event(data.type));
  }, { type, ready });
  const snapshot = () => page.locator('video').evaluate(video => ({
    paused: video.paused, position: video.currentTime, plays: window.bufferingAudit.plays,
  }));
  const open = () => page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  const exit = async () => {
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
  };
  const waiting = async () => {
    await emit('waiting', 2);
    await page.getByText('正在准备画面…', { exact: true }).waitFor();
  };
  const recovered = () => page.waitForFunction(() => !document.querySelector('.player-center'), undefined, { timeout: 1500 });
  try {
    await page.evaluate(tvMode => {
      window.reliability.boot.preferences.tvMode = tvMode;
      const state = window.bufferingAudit = { plays: 0, ready: undefined, metadata: [] };
      const ready = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
      Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
        configurable: true, get() { return state.ready ?? ready.get.call(this); },
      });
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { state.plays++; return play.call(this); };
      const dispatch = HTMLMediaElement.prototype.dispatchEvent;
      HTMLMediaElement.prototype.dispatchEvent = function (event) {
        if (state.holdMetadata && event.type === 'loadedmetadata') {
          state.metadata.push(() => dispatch.call(this, event));
          return true;
        }
        return dispatch.call(this, event);
      };
      const resolve = window.hub.resolve;
      window.hub.resolve = async (...args) => ({ ...await resolve(...args), live: !!state.live });
    }, tvMode);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await open();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await connectPad(page);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.locator('video').evaluate(video => { video.currentTime = 47.25; });
    const paused = await snapshot();
    await waiting();
    await emit('canplay', 3);
    await recovered();
    assert.deepEqual(await snapshot(), paused);
    assert.equal(await page.locator('.playing-badge').innerText(), '已暂停');
    assert.equal(await page.getByRole('button', { name: '继续播放', exact: true }).evaluate(node => node === document.activeElement), true);
    checks.push(`${label}: data recovery clears paused buffering without playing, seeking or changing focus`);
    await page.screenshot({ path: resolve(output, tvMode ? 'television.png' : 'desktop.png') });

    await pressPad(page, 9);
    const playing = await snapshot();
    await waiting();
    await emit('canplay', 4);
    await recovered();
    assert.deepEqual(await snapshot(), playing);
    checks.push(`${label}: playing recovery removes buffering without issuing another play request`);

    await waiting();
    await pressPad(page, 9);
    await page.getByRole('button', { name: '播放速度', exact: true }).click();
    const selected = page.getByRole('dialog').locator('[data-option-id="1"]');
    await selected.focus();
    const editing = await snapshot();
    await emit('canplay', 3);
    await page.waitForFunction(() => !document.querySelector('.player-center'));
    assert.deepEqual(await snapshot(), editing);
    assert.equal(await selected.evaluate(node => node === document.activeElement), true);
    await pressPad(page, 1);
    checks.push(`${label}: pausing during buffering and opening a menu preserves pause, selection and return focus at recovery`);

    await waiting();
    for (const level of [1, 2]) {
      await emit('canplay', level);
      assert.equal(await page.locator('.player-center').count(), 1);
    }
    await emit('canplay', 3);
    await recovered();
    checks.push(`${label}: insufficient data cannot falsely report recovery; future data clears the indicator`);

    await page.evaluate(() => { window.bufferingAudit.oldVideo = document.querySelector('video'); });
    await exit();
    await page.evaluate(() => { window.bufferingAudit.holdMetadata = true; });
    await open();
    await page.waitForFunction(() => window.bufferingAudit.metadata.length > 0);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const beforeMetadata = await snapshot();
    await page.evaluate(() => {
      window.bufferingAudit.ready = 4;
      window.bufferingAudit.oldVideo.dispatchEvent(new Event('canplay'));
    });
    assert.equal(await page.locator('.player-center').count(), 1);
    await emit('canplay', 4);
    assert.equal(await page.locator('.player-center').count(), 1);
    await page.evaluate(() => {
      window.bufferingAudit.holdMetadata = false;
      window.bufferingAudit.metadata.shift()();
    });
    await recovered();
    assert.deepEqual(await snapshot(), beforeMetadata);
    checks.push(`${label}: released-source and premature readiness events cannot bypass session metadata or paused startup`);

    await waiting();
    await emit('error', 4);
    await page.locator('.player-error').waitFor();
    const failed = await snapshot();
    await emit('canplay', 4);
    assert.deepEqual(await snapshot(), failed);
    assert.equal(await page.getByRole('button', { name: '重试', exact: true }).evaluate(node => node === document.activeElement), true);
    assert.equal(await page.locator('.player-error').count(), 1);
    await page.getByRole('button', { name: '返回浏览', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    checks.push(`${label}: late data recovery cannot revive a failed session or replace its focused retry`);

    await page.evaluate(() => { window.bufferingAudit.live = true; });
    await open();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await waiting();
    await pressPad(page, 9);
    const live = await snapshot();
    await emit('canplay', 3);
    await recovered();
    assert.deepEqual(await snapshot(), live);
    assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1);
    await exit();
    assert.deepEqual(errors, []);
    checks.push(`${label}: paused live recovery also clears buffering and retains normal speed`);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
