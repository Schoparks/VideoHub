import assert from 'node:assert/strict';
import { revealPlayerControls } from './player-test-actions.mjs';

/** Real paused media with synthetic pointer events, never system input. */
export async function checkPlayerPreviewOwnership(page) {
  await revealPlayerControls(page);
  await page.getByRole('button', { name: '暂停', exact: true }).evaluate(button => button.click());
  await page.waitForFunction(() => document.querySelector('video')?.paused);
  const before = await page.locator('video').evaluate(video => video.currentTime);
  await page.locator('.player-overlay h2').focus();
  await page.keyboard.press(']');
  await page.locator('.player[data-seeking="true"]').waitFor();
  const timeline = page.getByRole('slider', { name: '播放进度', exact: true });
  await page.locator('video').dispatchEvent('pointerdown', { pointerId: 1 });
  await timeline.dispatchEvent('pointerup', { pointerId: 1 });
  await timeline.dispatchEvent('pointercancel', { pointerId: 77 });
  const unconfirmed = await page.locator('video').evaluate(video => video.currentTime);
  assert.ok(Math.abs(unconfirmed - before) < .05);
  assert.equal(await page.locator('.player').getAttribute('data-seeking'), 'true');
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await page.keyboard.press('Enter');
  await page.locator('.player[data-seeking="false"]').waitFor();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video?.readyState >= 2 && !video.seeking;
  }, undefined, { timeout: 60000 });
  const confirmed = await page.locator('video').evaluate(video => ({
    position: video.currentTime, paused: video.paused, rate: video.playbackRate,
    width: video.videoWidth, height: video.videoHeight,
  }));
  assert.ok(Math.abs(confirmed.position - (before + 30)) < .05);
  assert.equal(confirmed.paused, true);
  assert.equal(confirmed.rate, 2);
  assert.equal(confirmed.width, 1920);
  await page.getByRole('button', { name: '继续播放', exact: true }).evaluate(button => button.click());
  await page.waitForFunction(position => {
    const video = document.querySelector('video');
    return video && !video.paused && video.currentTime > position + .1;
  }, confirmed.position, { timeout: 60000 });
  return { syntheticPointer: true, before, unconfirmed, confirmed, resumed: true };
}
