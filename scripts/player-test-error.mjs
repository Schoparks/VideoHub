import assert from 'node:assert/strict';

/** Synthetic renderer error on a real decoded stream; retry uses the real resolver/media. */
export async function checkPlayerErrorRecovery(page, quality) {
  const width = quality === 64 ? 1280 : 1920;
  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
  await page.locator('.player-error').waitFor();
  await page.waitForFunction(() => document.querySelector('video')?.paused === true);
  const position = await page.locator('video').evaluate(video => video.currentTime);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  assert.ok(Math.abs(await page.locator('video').evaluate(video => video.currentTime) - position) < .05);
  const retry = page.getByRole('button', { name: '重试', exact: true });
  assert.equal(await retry.evaluate(node => node === document.activeElement), true);
  await page.evaluate(() => {
    window.errorRetryAudit = [];
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    if (!descriptor?.set) throw new Error('无法读取媒体定位接口');
    window.errorRetryDescriptor = descriptor;
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      ...descriptor,
      set(value) {
        descriptor.set.call(this, value);
        if (this instanceof HTMLVideoElement) window.errorRetryAudit.push({
          requested: value, position: this.currentTime, width: this.videoWidth, ready: this.readyState,
        });
      },
    });
  });
  if (quality !== undefined) {
    await page.getByRole('button', { name: '选择清晰度', exact: true }).evaluate(button => button.click());
    const menu = page.getByRole('dialog', { name: '清晰度', exact: true });
    await menu.waitFor();
    await menu.locator(`[data-option-id="${quality}"]`).evaluate(button => button.click());
  } else await retry.evaluate(button => button.click());
  await page.waitForFunction(({ position, width }) => {
    const video = document.querySelector('video');
    return video?.videoWidth === width && !video.paused && video.currentTime > position + .1
      && !document.querySelector('.player-error');
  }, { position, width }, { timeout: 60000 });
  const media = await page.locator('video').evaluate(video => ({
    width: video.videoWidth, height: video.videoHeight, position: video.currentTime, rate: video.playbackRate,
  }));
  assert.equal(media.rate, 2);
  const metadata = await page.evaluate(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', window.errorRetryDescriptor);
    delete window.errorRetryDescriptor;
    return window.errorRetryAudit;
  });
  const restored = metadata.find(entry => entry.width === width && entry.ready >= 1
    && Math.abs(entry.requested - position) < .05 && Math.abs(entry.position - position) < .05);
  assert.ok(restored, JSON.stringify({ failurePosition: position, restores: metadata }));
  return { syntheticError: true, pausedBeforeRetry: true, retryFocused: true,
    quality, failurePosition: position, restoredPosition: restored.position, retryDecoded: true, media };
}
