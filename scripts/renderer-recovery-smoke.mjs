import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-recovery');
await mkdir(output, { recursive: true });
const session = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const { page, errors } = session;
const checks = [];
const activeName = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
const play = async () => {
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('video') && !document.querySelector('video').paused);
};

try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await play();
  await connectPad(page);
  await page.waitForTimeout(5200);
  await page.locator('video').evaluate(video => {
    video.currentTime = 120;
    video.pause();
    video.dispatchEvent(new Event('ended'));
  });
  await page.waitForFunction(() => document.querySelector('.player.controls-visible[data-ended="true"]'));
  assert.equal(await page.locator('.playing-badge').innerText(), '已播完');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '重新播放');
  assert.equal(await activeName(), '重新播放');
  assert.ok((await page.locator('.controller-actions').innerText()).includes('重新播放'));
  await pressPad(page, 0);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 0);
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  assert.equal(await page.locator('.playing-badge').innerText(), '正在播放');
  checks.push('ending from hidden controls reveals completed status and a focused replay action; A restarts at zero');

  await page.locator('video').evaluate(video => {
    video.currentTime = 47.25;
    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('error'));
  });
  await page.getByRole('button', { name: '重试', exact: true }).waitFor();
  const before = await page.evaluate(() => window.reliability.resolves.length);
  const oldSession = await page.evaluate(() => window.reliability.resolves.at(-1).sessionId);
  await page.evaluate(() => { window.reliability.holdResolve = true; });
  await pressPad(page, 0);
  await page.getByRole('button', { name: '正在重试…', exact: true }).waitFor();
  await pressPad(page, 0);
  await pressPad(page, 9);
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), before + 1);
  assert.equal(await page.getByRole('button', { name: '正在重试…', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForFunction(() => !document.querySelector('.player-error') && !document.querySelector('video').paused);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 47.25);
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:1');
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).quality), 80);
  await page.waitForFunction(session => window.reliability.releases.includes(session), oldSession);
  checks.push('retry reparses the same part and quality into a fresh session, retains exact position and blocks duplicate/conflicting actions');

  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
  await page.getByRole('button', { name: '重试', exact: true }).waitFor();
  await page.evaluate(() => { window.reliability.holdResolve = true; });
  await pressPad(page, 0);
  await page.getByRole('button', { name: '正在重试…', exact: true }).waitFor();
  const lateSession = await page.evaluate(() => window.reliability.resolves.at(-1).sessionId);
  await pressPad(page, 1);
  await page.waitForFunction(() => !document.querySelector('.player'));
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForFunction(session => window.reliability.releases.includes(session), lateSession);
  assert.equal(await page.locator('.player').count(), 0);
  checks.push('B cancels a retry and releases its late replacement without reopening the player');

  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.getByRole('button', { name: /^播放队列/ }).click();
  await page.evaluate(() => {
    const original = window.hub.queue;
    window.recoveryQueue = { calls: 0, hold: true, fail: true };
    window.hub.queue = async items => {
      const state = window.recoveryQueue;
      state.calls++;
      if (state.hold) await new Promise(resolve => { state.finish = resolve; });
      if (state.fail) throw new Error('队列保存失败');
      return original(items);
    };
  });
  const move = page.getByRole('button', { name: '下移 可靠性测试', exact: true });
  await move.focus();
  await pressPad(page, 0);
  await page.waitForTimeout(150);
  assert.equal(await activeName(), '下移 可靠性测试');
  assert.equal(await move.getAttribute('aria-disabled'), 'true');
  await pressPad(page, 0);
  assert.equal(await page.evaluate(() => window.recoveryQueue.calls), 1);
  await page.evaluate(() => window.recoveryQueue.finish());
  await page.locator('.toast').filter({ hasText: '队列保存失败' }).waitFor();
  assert.equal(await activeName(), '下移 可靠性测试');
  assert.deepEqual(await page.locator('.queue-title').allTextContents(), ['可靠性测试bilibili', '另一项bilibili']);
  checks.push('queue save waits keep the original focus and reject duplicate A; failed writes retain order and retry position');

  await page.evaluate(() => { window.recoveryQueue.hold = false; window.recoveryQueue.fail = false; });
  await pressPad(page, 0);
  await page.waitForFunction(() => document.querySelector('.queue-row:last-child .queue-title')?.getAttribute('aria-label') === '播放 可靠性测试');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放 可靠性测试');
  await page.getByRole('button', { name: '移除 可靠性测试', exact: true }).focus();
  await pressPad(page, 0);
  await page.waitForFunction(() => document.querySelectorAll('.queue-row').length === 1);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放 另一项');
  checks.push('moving to a disabled boundary keeps focus on the moved item; removal selects the adjacent play action');
  await page.screenshot({ path: resolve(output, 'queue-focus.png') });

  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.evaluate(() => {
    window.reliability.omitParts = false;
    window.reliability.partsOverride = [{ id: 'cid:1', cid: 1, title: '唯一分集' }];
    window.reliability.boot.queue = [];
  });
  await play();
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByRole('combobox', { name: '播完后', exact: true }).selectOption('next');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.locator('video').evaluate(video => {
    video.currentTime = 120; video.pause(); video.dispatchEvent(new Event('ended'));
  });
  await page.waitForFunction(() => document.querySelector('.player[data-ended="true"][data-switching="false"]'));
  assert.equal(await page.locator('.playing-badge').innerText(), '已播完');
  assert.equal(await page.getByRole('button', { name: '重新播放', exact: true }).isVisible(), true);
  await page.screenshot({ path: resolve(output, 'completed.png') });
  checks.push('auto-next at the final item keeps completed controls and replay available');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors, output }, null, 2));
} finally {
  await session.close();
}
