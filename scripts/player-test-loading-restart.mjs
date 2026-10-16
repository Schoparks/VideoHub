import assert from 'node:assert/strict';
import { choosePlayerRate } from './player-test-actions.mjs';
import { holdPlayerMedia } from './player-test-network.mjs';

/** Reopen actual saved media and hold its original gateway before metadata arrives. */
export async function checkLoadingRestart(page, open) {
  const savedPosition = await page.evaluate(async () => {
    const history = (await window.hub.bootstrap()).history;
    return history.find(entry => entry.part?.episodeId === 278480)?.position;
  });
  assert.ok(savedPosition >= 18, '加载重播验证需要实际已保存的续播位置');
  const gate = await holdPlayerMedia(page);
  try {
    await open();
    await page.getByRole('button', { name: '播放速度', exact: true }).waitFor();
    for (let attempt = 0; !gate.count() && attempt < 100; attempt++) await page.waitForTimeout(20);
    assert.ok(gate.count() > 0, '加载重播未观察到被延迟的真实媒体请求');
    const readyBefore = await page.locator('video').evaluate(video => video.readyState);
    assert.equal(readyBefore, 0);
    const displayedResume = await page.locator('.timecode').innerText();
    assert.ok(!displayedResume.startsWith('0:00 /'), '当前播放器未准备正常续播位置');
    await choosePlayerRate(page, 2);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
    await page.getByRole('button', { name: '从头播放', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    assert.equal(await page.locator('video').evaluate(video => video.readyState), 0);
    const heldRequests = gate.count();
    await gate.release();
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video?.videoWidth === 1920 && !video.paused && video.currentTime > .1 && video.currentTime < 5;
    }, undefined, { timeout: 60000 });
    const media = await page.locator('video').evaluate(video => ({
      width: video.videoWidth, height: video.videoHeight, position: video.currentTime,
      paused: video.paused, rate: video.playbackRate,
    }));
    assert.equal(media.rate, 2);
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('video'));
    return { savedPosition, displayedResume, readyBefore, heldRequests, actualRestart: true, media };
  } finally { await gate.release(); }
}
