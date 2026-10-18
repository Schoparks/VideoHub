import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { assertFrontendLayout } from './frontend-layout.mjs';

export async function checkPlaybackSettings(page, output) {
  const checks = [];
  const settings = () => page.getByRole('button', { name: '设置', exact: true }).click();
  const closeSettings = () => page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  const play = async () => {
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('video') && !document.querySelector('video').paused);
  };
  const leave = async () => {
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
  };
  await settings();
  await page.getByRole('combobox', { name: '播完后', exact: true }).selectOption('pause');
  await page.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('1.5');
  assert.equal(await page.getByRole('slider', { name: '默认音量', exact: true }).count(), 0);
  await assertFrontendLayout(page, 'playback-settings');
  await closeSettings();
  await play();
  const initial = await page.locator('video').evaluate(video => ({ rate: video.playbackRate, volume: video.volume }));
  assert.deepEqual(initial, { rate: 1.5, volume: 1 });
  const before = await page.evaluate(() => window.reliability.resolves.length);
  await page.locator('video').evaluate(video => {
    video.currentTime = 120; video.pause(); video.dispatchEvent(new Event('ended'));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), before);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByRole('combobox', { name: '播完后', exact: true }).selectOption('next');
  await closeSettings();
  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('ended')));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), before);
  // Enabling autoplay does not resurrect an already consumed completion event.
  await page.getByRole('button', { name: '重新播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('video').paused);
  await page.locator('video').evaluate(video => {
    video.currentTime = 120; video.pause(); video.dispatchEvent(new Event('ended'));
  });
  await page.waitForFunction(() => document.querySelector('.player-overlay header p')?.textContent?.includes('测试第 2 集'));
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:2');
  checks.push('end behavior pauses or continues episodes as selected; playback rate applies and volume controls are absent');

  assert.equal(await page.evaluate(() => window.reliability.danmakuCalls), 0);
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByRole('tab', { name: '弹幕', exact: true }).click();
  await page.getByRole('switch', { name: '显示 B 站视频弹幕', exact: true }).click();
  await page.getByRole('combobox', { name: '弹幕字号', exact: true }).selectOption('32');
  await page.getByRole('combobox', { name: '弹幕显示区域', exact: true }).selectOption('0.25');
  await page.getByRole('slider', { name: '弹幕不透明度', exact: true }).scrollIntoViewIfNeeded();
  await assertFrontendLayout(page, 'danmaku-settings');
  await page.screenshot({ path: resolve(output, 'playback-settings.png') });
  await closeSettings();
  await page.locator('video').evaluate(video => { video.currentTime = 1.5; video.pause(); });
  await page.locator('.danmaku-layer span').filter({ hasText: '同步弹幕' }).waitFor();
  const pausedTransforms = await page.locator('.danmaku-layer span').evaluateAll(items => items.map(item => getComputedStyle(item).transform));
  await page.waitForTimeout(100);
  assert.deepEqual(await page.locator('.danmaku-layer span').evaluateAll(items => items.map(item => getComputedStyle(item).transform)), pausedTransforms);
  assert.equal(await page.locator('.danmaku-layer').evaluate(layer => layer.style.fontSize), '32px');
  assert.equal(await page.locator('.danmaku-layer img').count(), 0);
  await page.locator('video').evaluate(video => { video.currentTime = 30; });
  await page.waitForFunction(() => !document.querySelector('.danmaku-layer span'));
  await page.locator('video').evaluate(video => { video.currentTime = 1.5; });
  await page.locator('.danmaku-layer span').filter({ hasText: '同步弹幕' }).waitFor();
  await page.getByRole('button', { name: '显示弹幕', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.danmaku-layer'));
  checks.push('danmaku defaults off, settings and quick toggle apply; pause freezes comments and seeks restore media-time content safely');

  await page.evaluate(() => { window.reliability.danmakuMode = 'error'; });
  await page.getByRole('button', { name: '显示弹幕', exact: true }).click();
  await page.locator('.player-hints small').filter({ hasText: '弹幕加载失败' }).waitFor();
  assert.equal(await page.locator('.player-error').count(), 0);
  await page.getByRole('button', { name: '显示弹幕', exact: true }).click();
  await page.evaluate(() => { window.reliability.danmakuMode = 'loading'; });
  await page.getByRole('button', { name: '显示弹幕', exact: true }).click();
  await page.waitForFunction(() => !!window.reliability.finishDanmaku);
  await page.evaluate(() => { window.reliability.finishLateDanmaku = window.reliability.finishDanmaku; });
  await leave();
  await page.evaluate(() => { window.reliability.danmakuMode = 'normal'; window.reliability.finishLateDanmaku(); });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.danmaku-layer').count(), 0);
  await settings();
  await page.getByRole('tab', { name: '弹幕', exact: true }).click();
  await page.getByRole('switch', { name: '显示 B 站视频弹幕', exact: true }).click();
  await closeSettings();
  checks.push('danmaku failures remain separate from video errors; late responses after leaving cannot reopen the overlay');
  return checks;
}
