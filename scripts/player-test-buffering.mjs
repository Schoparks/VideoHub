import assert from 'node:assert/strict';
import { revealPlayerControls } from './player-test-actions.mjs';
import { holdPlayerMedia } from './player-test-network.mjs';

/** Hold original gateway responses to observe native waiting/canplay on a real stream. */
export async function checkPlayerBuffering(page) {
  const gate = await holdPlayerMedia(page);
  try {
    await page.locator('video').evaluate(video => {
      const state = window.bufferingNative = { events: [], listeners: [] };
      for (const type of ['waiting', 'canplay']) {
        const listener = event => state.events.push({
          type, trusted: event.isTrusted, ready: video.readyState,
          paused: video.paused, position: video.currentTime,
        });
        state.listeners.push({ type, listener, video });
        video.addEventListener(type, listener);
      }
      video.currentTime = 1200;
    });
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video?.readyState < 3 && window.bufferingNative.events.some(event => event.type === 'waiting' && event.trusted);
    }, undefined, { timeout: 15000 });
    for (let attempt = 0; !gate.count() && attempt < 150; attempt++) await page.waitForTimeout(100);
    const heldRequests = gate.count();
    assert.ok(heldRequests > 0, '缓冲检查没有观察到实际媒体网关请求');
    await page.getByText('正在准备画面…', { exact: true }).waitFor();
    await revealPlayerControls(page);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '播放速度', exact: true }).click();
    const menu = page.getByRole('dialog', { name: '播放速度', exact: true });
    const selected = menu.locator('[data-option-id="2"]');
    await selected.focus();
    const before = await page.locator('video').evaluate(video => video.currentTime);
    await gate.release();
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video?.readyState >= 3 && !video.seeking
        && window.bufferingNative.events.some(event => event.type === 'canplay' && event.trusted && event.paused);
    }, undefined, { timeout: 60000 });
    await page.waitForTimeout(100);
    const report = await page.locator('video').evaluate(video => ({
      events: window.bufferingNative.events,
      width: video.videoWidth, height: video.videoHeight, ready: video.readyState,
      paused: video.paused, position: video.currentTime, rate: video.playbackRate,
      indicatorCleared: !document.querySelector('.player-center'),
    }));
    assert.equal(report.indicatorCleared, true, `恢复后仍显示缓冲：${JSON.stringify(report)}`);
    assert.equal(report.paused, true);
    assert.equal(report.rate, 2);
    assert.equal(report.width, 1920);
    assert.ok(Math.abs(report.position - before) < .05);
    assert.equal(await selected.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.playing-badge').innerText(), '已暂停');
    await page.getByRole('button', { name: '继续播放', exact: true }).click();
    await page.waitForFunction(before => {
      const video = document.querySelector('video');
      return video && !video.paused && video.currentTime > before + .1;
    }, before);
    return { nativeEvents: true, heldRequests, ...report, menuFocusPreserved: true, explicitContinue: true };
  } finally {
    try { await gate.release(); }
    finally {
      await page.evaluate(() => {
        for (const { video, type, listener } of window.bufferingNative?.listeners || []) video.removeEventListener(type, listener);
      });
    }
  }
}
