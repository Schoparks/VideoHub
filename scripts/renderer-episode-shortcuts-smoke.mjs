import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-episode-shortcuts');
await mkdir(output, { recursive: true });
const checks = [];
for (const config of [
  { width: 1440, height: 950, tvMode: false, pause: 9 },
  { width: 1920, height: 1080, tvMode: true, pause: 8 },
]) {
  const { page, errors, close } = await launchHeadlessRenderer(config, installReliabilityFixture);
  const label = config.tvMode ? 'television / remapped pause' : 'desktop / Start';
  const menu = page.getByRole('dialog', { name: '选择分集', exact: true });
  const opener = page.getByRole('button', { name: '选集，共 2 集', exact: true });
  const paused = () => page.locator('video').evaluate(video => video.paused);
  const count = () => page.evaluate(() => window.reliability.resolves.length);
  const open = async () => {
    await opener.focus();
    await pressPad(page, 0);
    await menu.waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('.episode-option'));
  };
  const preserved = async (expectedPaused, requests) => {
    assert.equal(await paused(), expectedPaused);
    assert.equal(await count(), requests);
    assert.equal(await menu.count(), 1);
    assert.equal(await menu.evaluate(node => node.contains(document.activeElement)), true);
  };
  try {
    await page.evaluate(config => {
      window.reliability.boot.preferences.tvMode = config.tvMode;
      window.reliability.boot.preferences.gamepadMap.pause = config.pause;
    }, config);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await connectPad(page);
    await page.locator('video').evaluate(video => { video.currentTime = 37.5; });
    await open();
    const requests = await count();
    await pressPad(page, config.pause);
    await preserved(false, requests);
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 37.5);
    checks.push(`${label}: pause in episode selection preserves playing media and focus`);

    for (const button of [3, 4, 5, 6, 7]) await pressPad(page, button);
    await preserved(false, requests);
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 37.5);
    await pressPad(page, 13);
    assert.equal(await menu.locator('.episode-option').nth(1).evaluate(node => node === document.activeElement), true);
    await pressPad(page, 0);
    await menu.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.player-overlay header p')?.textContent?.includes('测试第 2 集'));
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    assert.equal(await count(), requests + 1);
    checks.push(`${label}: playback shortcuts stay isolated while D-pad and A choose an episode`);

    await pressPad(page, config.pause);
    assert.equal(await paused(), true);
    await open();
    const pausedRequests = await count();
    await pressPad(page, config.pause);
    await preserved(true, pausedRequests);
    await pressPad(page, 1);
    await menu.waitFor({ state: 'detached' });
    assert.equal(await opener.evaluate(node => node === document.activeElement), true);
    assert.equal(await paused(), true);
    assert.equal(await page.locator('.player.controls-visible').count(), 1);
    await pressPad(page, config.pause);
    assert.equal(await paused(), false);
    checks.push(`${label}: B closes selection to its opener; pause works again only in the player`);

    await open();
    await pressPad(page, 2);
    await menu.waitFor({ state: 'detached' });
    assert.equal(await opener.evaluate(node => node === document.activeElement), true);
    await open();
    const first = menu.locator('.episode-option').first();
    await first.focus();
    await page.keyboard.press('Space');
    await menu.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.player-overlay header p')?.textContent?.includes('测试第 1 集'));
    assert.equal(await count(), pausedRequests + 1);
    checks.push(`${label}: X closes selection and native Space confirms its focused episode`);

    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await open();
    await page.locator('video').evaluate(video => {
      video.currentTime = 120;
      video.pause();
      video.dispatchEvent(new Event('ended'));
    });
    await page.waitForFunction(() => document.querySelector('.player')?.getAttribute('data-ended') === 'true');
    const completedRequests = await count();
    await pressPad(page, config.pause);
    await preserved(true, completedRequests);
    assert.equal(await page.locator('.player').getAttribute('data-ended'), 'true');
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 120);
    assert.equal(await menu.locator('.episode-option[aria-current="true"]').getByText('已播完').count(), 1);
    await page.screenshot({ path: resolve(output, `${config.tvMode ? 'television' : 'desktop'}-ended.png`) });
    checks.push(`${label}: pause in completed selection cannot restart the underlying episode`);

    await pressPad(page, 0);
    await menu.waitFor({ state: 'detached' });
    assert.equal(await paused(), false);
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 0);
    assert.equal(await count(), completedRequests);
    checks.push(`${label}: explicit A on the completed current episode still replays from zero`);

    await pressPad(page, 1);
    await page.waitForFunction(() => document.querySelector('.player:not(.controls-visible)'));
    assert.equal(await paused(), false);
    await pressPad(page, 1);
    await page.waitForFunction(() => !document.querySelector('.player'));
    assert.deepEqual(errors, []);
    checks.push(`${label}: B still hides the controls before exiting playback; no page errors`);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
