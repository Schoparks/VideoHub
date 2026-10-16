import assert from 'node:assert/strict';
import { revealPlayerControls } from './player-test-actions.mjs';

/** Actual following-room playback in the already-hidden, muted account test. */
export async function checkFollowingLive(page) {
  const room = await page.evaluate(async () => {
    const result = await window.hub.browse({ kind: 'followingLive' });
    const item = result.items.find(item => item.badge === '直播中');
    return item ? { id: item.id, roomId: item.roomId } : undefined;
  });
  if (!room) return { available: false, decoded: false, reason: 'no active room in following page' };
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('2');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.locator(`.media-card[data-media-id="${room.id}"]`).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return document.querySelector('.player[data-live="true"]') && video?.videoWidth > 0
      && video.readyState >= 2 && !video.paused && video.currentTime > .3
      && video.getVideoPlaybackQuality().totalVideoFrames > 0;
  }, undefined, { timeout: 45000 });
  const media = await page.locator('video').evaluate(video => ({
    width: video.videoWidth, height: video.videoHeight, position: video.currentTime,
    rate: video.playbackRate, frames: video.getVideoPlaybackQuality().totalVideoFrames,
  }));
  assert.equal(media.rate, 1);
  assert.ok(media.width > 0 && media.frames > 0);
  await revealPlayerControls(page);
  assert.equal(await page.getByRole('button', { name: '播放速度', exact: true }).count(), 0);
  assert.equal(await page.getByRole('slider', { name: '播放进度', exact: true }).count(), 0);
  assert.equal(await page.locator('[data-player-action="next"]').isDisabled(), true);
  await page.keyboard.press('PageDown');
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const pausedAt = await page.locator('video').evaluate(video => video.currentTime);
  await page.waitForTimeout(500);
  const paused = await page.locator('video').evaluate(video => ({ paused: video.paused, position: video.currentTime, rate: video.playbackRate }));
  assert.equal(paused.paused, true);
  assert.equal(paused.rate, 1);
  assert.ok(Math.abs(paused.position - pausedAt) < .05);
  await page.keyboard.press('Escape');
  await page.locator('.player:not(.controls-visible)').waitFor();
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await page.keyboard.press('ArrowUp');
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  await page.waitForFunction(position => {
    const video = document.querySelector('video');
    return video && !video.paused && video.currentTime > position + .1;
  }, pausedAt);
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1);
  await revealPlayerControls(page);
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '默认播放速度', exact: true }).inputValue(), '2');
  await page.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('1');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  return { available: true, decoded: true, roomId: room.roomId, media,
    paused, resumed: true, defaultPreserved: true, layeredReturn: true, nextUnavailable: true };
}
