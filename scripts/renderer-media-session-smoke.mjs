import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { choosePlayerQuality } from './player-test-actions.mjs';

const checks = [];
for (const viewport of [{ width: 1440, height: 950 }, { width: 1920, height: 1080 }]) {
  const { page, errors, close } = await launchHeadlessRenderer(viewport, installReliabilityFixture);
  try {
    await page.evaluate(tv => {
      window.reliability.boot.preferences.tvMode = tv;
      window.reliability.boot.preferences.danmaku = true;
    }, viewport.width === 1920);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await page.locator('.danmaku-layer').waitFor();
    await page.locator('video').evaluate(video => { video.currentTime = 2; });
    await page.waitForFunction(() => document.querySelector('.danmaku-lane span'));
    assert.equal(await page.locator('.danmaku-layer').evaluate(node => getComputedStyle(node).opacity), '1');
    assert.equal(await page.locator('.danmaku-lane').evaluate(node => getComputedStyle(node).opacity), '0.8');
    checks.push(`${viewport.width}: actual player applies opacity to a shared lane without a full-screen alpha group`);
    await page.evaluate(() => { window.oldVideo = document.querySelector('video'); });
    await page.locator('.episode-toggle').click();
    await page.locator('.episode-option').nth(1).click();
    await page.waitForFunction(() => window.reliability.resolves.length === 2
      && document.querySelector('video')?.paused === false);
    assert.equal(await page.evaluate(() => window.oldVideo === document.querySelector('video')), false);
    assert.equal(await page.locator('video').count(), 1);
    await page.evaluate(() => {
      Object.defineProperty(window.oldVideo, 'error', { configurable: true, value: { code: 3 } });
      for (const name of ['error', 'pause', 'waiting', 'ended', 'loadedmetadata', 'playing']) {
        window.oldVideo.dispatchEvent(new Event(name));
      }
    });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.player-error').count(), 0);
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), 2);
    assert.equal(await page.evaluate(() => window.oldVideo.isConnected), false);
    checks.push(`${viewport.width}: a new part owns a fresh media element; retired media events cannot fail/end/pause it`);

    await page.locator('video').evaluate(video => { video.currentTime = 37.25; });
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.evaluate(() => { window.oldVideo = document.querySelector('video'); });
    await choosePlayerQuality(page, 64);
    await page.waitForFunction(() => window.reliability.resolves.length === 3
      && document.querySelector('video')?.currentTime === 37.25);
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    assert.equal(await page.evaluate(() => window.oldVideo === document.querySelector('video')), false);
    assert.equal(await page.evaluate(() => window.oldVideo.hasAttribute('src')), false);
    checks.push(`${viewport.width}: quality change releases old src and preserves precise position/paused intent`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await mkdir('.tmp/renderer-media-session', { recursive: true });
await writeFile('.tmp/renderer-media-session/checks.json', JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
