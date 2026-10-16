import assert from 'node:assert/strict';
import { revealPlayerControls } from './player-test-actions.mjs';

/** Seek near the real movie tail; wait for the native ended flag, never synthesize it. */
export async function checkPlayerCompletion(app, page) {
  await revealPlayerControls(page);
  await page.getByRole('button', { name: '播放设置', exact: true }).evaluate(button => button.click());
  await page.getByRole('combobox', { name: '播完后', exact: true }).selectOption('next');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).evaluate(button => button.click());
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await revealPlayerControls(page);
  await page.getByRole('button', { name: '播放速度', exact: true }).evaluate(button => button.click());
  const menu = page.getByRole('dialog', { name: '播放速度', exact: true });
  await menu.waitFor();
  await menu.locator('[data-option-id="2"]').focus();
  const requests = await app.evaluate(() => globalThis.movieAudit.responses.length);
  await page.locator('video').evaluate(video => { video.currentTime = video.duration - 1; });
  await page.waitForFunction(() => document.querySelector('video')?.ended === true
    && document.querySelector('.player')?.dataset.ended === 'true', undefined, { timeout: 60000 });
  const ended = await page.locator('video').evaluate(video => ({
    nativeEnded: video.ended, paused: video.paused, position: video.currentTime,
    duration: video.duration, width: video.videoWidth, rate: video.playbackRate,
  }));
  assert.equal(ended.width, 1920);
  assert.equal(ended.rate, 2);
  assert.equal(ended.paused, true);
  assert.equal(await menu.count(), 1);
  assert.equal(await menu.evaluate(node => node.contains(document.activeElement)), true);
  assert.equal(await app.evaluate(() => globalThis.movieAudit.responses.length), requests);
  // This movie has no later episode or queue item; ordinary close remains completed.
  assert.equal(await page.locator('.player').getAttribute('data-multipart'), 'false');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '重新播放', exact: true }).waitFor();
  assert.equal(await page.locator('[data-player-action="next"]').isDisabled(), true);
  await page.keyboard.press('PageDown');
  assert.equal(await app.evaluate(() => globalThis.movieAudit.responses.length), requests);
  assert.equal(await page.locator('.toast').allTextContents().then(texts => texts.includes('已经是最后一项')), false);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await page.keyboard.press('PageUp');
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && !video.ended && !video.paused && video.currentTime > .1 && video.currentTime < 5;
  }, undefined, { timeout: 60000 });
  assert.equal(await app.evaluate(() => globalThis.movieAudit.responses.length), requests);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.locator('video').evaluate(video => { video.currentTime = 18.25; });
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video?.paused && !video.seeking && video.readyState >= 2;
  }, undefined, { timeout: 60000 });
  await page.keyboard.press(']');
  await page.locator('.player[data-seeking="true"]').waitFor();
  assert.equal(await page.locator('.seek-preview').count(), 1);
  await page.getByRole('button', { name: '从头播放', exact: true }).click();
  await page.locator('.player[data-seeking="false"]').waitFor();
  assert.equal(await page.locator('.seek-preview').count(), 0);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && !video.paused && video.currentTime > .1 && video.currentTime < 5;
  }, undefined, { timeout: 60000 });
  assert.equal(await app.evaluate(() => globalThis.movieAudit.responses.length), requests);
  await page.getByRole('button', { name: '播放设置', exact: true }).evaluate(button => button.click());
  await page.getByRole('combobox', { name: '播完后', exact: true }).selectOption('pause');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).evaluate(button => button.click());
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  return { nativeCompletion: true, soughtNearTail: true, ended, menuPreserved: true,
    focusPreserved: true, noResolveDuringEditing: true, completedLastItem: true, nextUnavailable: true, actualReplay: true,
    replayShortcut: 'PageUp', pausedPointerRestart: true, discardedSeekPreview: true, sameSessionRestart: true };
}
