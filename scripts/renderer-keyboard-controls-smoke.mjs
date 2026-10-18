import { openSearchKeyboard } from './search-test-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-keyboard-controls');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const space = async locator => { await locator.focus(); await page.keyboard.press('Space'); };
const isPaused = () => page.locator('video').evaluate(video => video.paused);

try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dark = page.getByRole('switch', { name: '深色外观', exact: true });
  await space(dark);
  assert.equal(await dark.isChecked(), true);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await space(dark);
  assert.equal(await dark.isChecked(), false);
  await space(page.getByRole('button', { name: '关闭弹窗', exact: true }));
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  checks.push('Space natively toggles and persists settings switches, and activates dialog close');

  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('video') && !document.querySelector('video').paused);
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByRole('tab', { name: '弹幕', exact: true }).click();
  const danmaku = page.getByRole('switch', { name: '显示 B 站视频弹幕', exact: true });
  await space(danmaku);
  assert.equal(await danmaku.isChecked(), true);
  assert.equal(await isPaused(), false);
  await space(page.getByRole('button', { name: '关闭弹窗', exact: true }));
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放设置');
  checks.push('player settings Space operates the active switch without pausing the inert background player');

  const speed = page.getByRole('button', { name: '播放速度', exact: true });
  await speed.click();
  await connectPad(page);
  const rate = page.getByRole('dialog', { name: '播放速度', exact: true }).getByRole('button', { name: '1.5×', exact: true });
  await rate.focus();
  await pressPad(page, 9);
  assert.equal(await isPaused(), false);
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1);
  await space(rate);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1.5);
  assert.equal(await speed.evaluate(node => node === document.activeElement), true);
  assert.equal(await isPaused(), false);
  checks.push('Space confirms the focused rate and returns to its opener; gamepad Start remains isolated in menus');

  await speed.focus();
  await page.keyboard.press('Space');
  assert.equal(await isPaused(), true);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.keyboard.press('Space');
  assert.equal(await isPaused(), false);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.player:not(.controls-visible)'));
  await page.keyboard.press('Space');
  assert.equal(await isPaused(), true);
  await page.keyboard.press('Space');
  assert.equal(await isPaused(), false);
  checks.push('Space keeps its pause/resume shortcut in the active player, including hidden controls');

  await page.getByRole('button', { name: '选集，共 2 集', exact: true }).click();
  const episode = page.getByRole('dialog', { name: '选择分集', exact: true }).locator('.episode-option').nth(1);
  await space(episode);
  await page.waitForFunction(() => document.querySelector('.player-overlay header p')?.textContent?.includes('测试第 2 集'));
  checks.push('Space chooses a focused episode instead of toggling the background video');

  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
  const retry = page.getByRole('button', { name: '重试', exact: true });
  await retry.waitFor();
  const beforeRetry = await page.evaluate(() => window.reliability.resolves.length);
  await space(retry);
  await page.waitForFunction(() => !document.querySelector('.player-error') && !document.querySelector('video').paused);
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), beforeRetry + 1);
  checks.push('Space activates the playback error retry within its own focus scope');

  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  const initialRequests = await page.evaluate(() => window.reliability.resolves.length);
  await space(page.getByRole('button', { name: '下移 可靠性测试', exact: true }));
  await page.waitForFunction(() => window.reliability.boot.queue[0].title === '另一项');
  assert.equal(await isPaused(), false);
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), initialRequests);
  await space(page.getByRole('button', { name: '关闭弹窗', exact: true }));
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  checks.push('Space operates queue actions while preserving the background playback session');

  await openSearchKeyboard(page);
  const keyword = page.getByRole('textbox', { name: '搜索关键词', exact: true });
  await keyword.fill('测试');
  await page.keyboard.press('End');
  await page.keyboard.press('Space');
  assert.equal(await keyword.inputValue(), '测试 ');
  await space(page.locator('.search-dialog form').getByRole('button', { name: '搜索', exact: true }));
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.reliability.browse.some(request => request.kind === 'search' && request.keyword === '测试'));
  checks.push('text entry keeps native spaces; Space activates the search submit button');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '手柄', exact: true }).click();
  const binding = page.locator('.bindings button').first();
  await binding.click();
  await page.locator('[data-calibrating="true"]').waitFor();
  await space(binding);
  assert.equal(await binding.getAttribute('data-calibrating'), 'true');
  await page.keyboard.press('Escape');
  await page.locator('[data-calibrating="true"]').waitFor({ state: 'detached' });
  checks.push('Space cannot reactivate mapping controls during capture; Escape still cancels');

  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
