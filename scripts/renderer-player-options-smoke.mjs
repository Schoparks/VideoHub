import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-player-options');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const speed = page.getByRole('button', { name: '播放速度', exact: true });
const quality = page.getByRole('button', { name: '清晰度', exact: true });
const menu = name => page.getByRole('dialog', { name, exact: true });
const focused = locator => locator.evaluate(node => document.activeElement === node);
const play = async () => {
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('video') && !document.querySelector('video').paused);
};
const finishBack = async () => {
  await pressPad(page, 1);
  await page.waitForFunction(() => !document.querySelector('.player.controls-visible'));
  await pressPad(page, 1);
  await page.waitForFunction(() => !document.querySelector('.player'));
};

try {
  await page.evaluate(() => {
    const original = window.hub.resolve;
    window.hub.resolve = async (item, part, quality, position) => ({
      ...await original(item, part, quality), startAt: position ?? 0,
    });
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await play();
  await connectPad(page);
  const initialRequests = await page.evaluate(() => window.reliability.resolves.length);
  await speed.focus();
  await pressPad(page, 15);
  assert.equal(await focused(quality), true);
  await pressPad(page, 15);
  assert.equal(await focused(quality), false);
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1);
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), initialRequests);
  checks.push('speed and quality are navigable buttons; directional movement neither edits values nor reparses media');

  await speed.focus();
  await pressPad(page, 0);
  await menu('播放速度').waitFor();
  assert.equal(await focused(menu('播放速度').getByRole('button', { name: '1×', exact: true })), true);
  assert.equal(await page.locator('.player-overlay').evaluate(node => node.inert), true);
  await pressPad(page, 13);
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1);
  for (const button of [4, 5, 6, 7, 9, 3, 2]) await pressPad(page, button);
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), initialRequests);
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  await page.waitForTimeout(5200);
  assert.equal(await page.locator('.player').evaluate(node => node.classList.contains('controls-visible')), true);
  await menu('播放速度').getByRole('button', { name: '2×', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await focused(menu('播放速度').getByRole('button', { name: '关闭播放速度', exact: true })), true);
  await pressPad(page, 1);
  await menu('播放速度').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放速度');
  assert.equal(await speed.getAttribute('data-option-value'), '1');
  checks.push('A opens the current selection; menu traps focus, suppresses playback shortcuts, remains visible and B cancels to its opener');

  await pressPad(page, 0);
  await menu('播放速度').waitFor();
  await menu('播放速度').getByRole('button', { name: '1.5×', exact: true }).focus();
  await pressPad(page, 0);
  await menu('播放速度').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放速度');
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1.5);
  checks.push('a confirmed speed applies once and returns focus to its button');

  await quality.focus();
  await pressPad(page, 0);
  await menu('清晰度').waitFor();
  await pressPad(page, 13);
  await pressPad(page, 1);
  await menu('清晰度').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), initialRequests);
  await pressPad(page, 0);
  await menu('清晰度').waitFor();
  await pressPad(page, 0);
  await menu('清晰度').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), initialRequests);
  checks.push('canceling quality or confirming the current quality makes no replacement request');

  await page.locator('video').evaluate(video => { video.currentTime = 37.5; });
  await page.evaluate(() => { window.reliability.holdResolve = true; });
  await quality.focus();
  await pressPad(page, 0);
  await menu('清晰度').getByRole('button', { name: '720P', exact: true }).focus();
  await pressPad(page, 0);
  await menu('清晰度').waitFor({ state: 'detached' });
  await page.waitForFunction(() => !!window.reliability.finishResolve);
  assert.equal(await focused(quality), true);
  await pressPad(page, 0);
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), initialRequests + 1);
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForFunction(() => document.querySelector('[aria-label="清晰度"]')?.getAttribute('data-option-value') === '64'
    && document.querySelector('.player')?.getAttribute('data-switching') === 'false');
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 37.5);
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1.5);
  assert.equal(await focused(quality), true);
  await pressPad(page, 0);
  await menu('清晰度').getByRole('button', { name: '1080P', exact: true }).focus();
  await pressPad(page, 0);
  await page.waitForFunction(() => document.querySelector('[aria-label="清晰度"]')?.getAttribute('data-option-value') === '80'
    && document.querySelector('.player')?.getAttribute('data-switching') === 'false');
  assert.equal(await focused(quality), true);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 37.5);
  checks.push('a confirmed quality keeps position and speed, retains the opener while loading and blocks duplicate replacement');

  const releases = await page.evaluate(() => window.reliability.releases.length);
  await pressPad(page, 1);
  await page.waitForFunction(() => !!document.querySelector('.player:not(.controls-visible)'));
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  assert.equal(await page.evaluate(() => window.reliability.releases.length), releases);
  assert.equal(await page.locator('.player-overlay').evaluate(node => node.inert), true);
  await pressPad(page, 1);
  await page.waitForFunction(() => !document.querySelector('.player'));
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放 可靠性测试');
  checks.push('visible-controls B only hides the overlay without pausing or releasing; the next B exits and returns to the card');

  await play();
  await page.locator('video').evaluate(video => { video.currentTime = 42; });
  await pressPad(page, 7);
  await page.waitForFunction(() => document.querySelector('.player')?.getAttribute('data-seeking') === 'true');
  await pressPad(page, 1);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 42);
  assert.equal(await page.locator('.player').evaluate(node => node.classList.contains('controls-visible')), true);
  await pressPad(page, 2);
  await menu('选择分集').waitFor();
  await pressPad(page, 1);
  await menu('选择分集').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.player').evaluate(node => node.classList.contains('controls-visible')), true);
  await finishBack();
  checks.push('B cancels a pending seek or closes episodes before hiding controls, and neither commits nor exits early');

  await play();
  await pressPad(page, 9);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await pressPad(page, 1);
  await page.waitForFunction(() => document.querySelector('.player:not(.controls-visible)'));
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await pressPad(page, 12);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '继续播放');
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await finishBack();
  checks.push('manually hiding paused controls does not resume playback; Up reveals a usable continue button');

  await page.getByRole('button', { name: '切换电视模式', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await play();
  await quality.click();
  await menu('清晰度').waitFor();
  const targets = await menu('清晰度').locator('button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { inBounds: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      reachable: button === hit || button.contains(hit) };
  }));
  assert.ok(targets.every(target => target.inBounds && target.reachable));
  await page.screenshot({ path: resolve(output, 'television-quality.png'), animations: 'disabled' });
  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
  await menu('清晰度').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '重试', exact: true }).waitFor();
  await pressPad(page, 1);
  await page.waitForFunction(() => !document.querySelector('.player'));
  checks.push('TV options are reachable; media failure closes the option menu and B exits the error directly');

  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png'), animations: 'disabled' }).catch(() => {});
  throw error;
} finally { await close(); }
