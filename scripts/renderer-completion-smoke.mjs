import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-completion');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const requests = () => page.evaluate(() => window.reliability.resolves.length);
const finish = () => page.locator('video').evaluate(video => {
  video.currentTime = 120;
  video.pause();
  video.dispatchEvent(new Event('ended'));
});
const play = async () => {
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
};
const reset = async () => {
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  await play();
};
const menu = name => page.getByRole('dialog', { name, exact: true });
const remain = async (scope, count) => {
  await page.waitForTimeout(150);
  assert.equal(await requests(), count);
  assert.equal(await scope.count(), 1);
  assert.equal(await scope.evaluate(node => node.contains(document.activeElement)), true);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  assert.equal(await page.locator('.player').getAttribute('data-ended'), 'true');
};

try {
  await page.evaluate(() => { window.reliability.boot.preferences.autoNext = true; });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await play();
  await connectPad(page);
  await page.getByRole('button', { name: '播放速度', exact: true }).click();
  const rate = menu('播放速度');
  const initial = await requests();
  await finish();
  await remain(rate, initial);
  await page.screenshot({ path: resolve(output, 'desktop-rate-ended.png'), animations: 'disabled' });
  await finish();
  await remain(rate, initial);
  await rate.getByRole('button', { name: '2×', exact: true }).focus();
  await pressPad(page, 0);
  await page.waitForFunction(count => window.reliability.resolves.length === count + 1
    && !document.querySelector('video').paused, initial);
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:2');
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 2);
  checks.push('completion preserves rate-menu focus and editing, repeated ended does not duplicate requests; closing advances once to the next part');

  await reset();
  await page.getByRole('button', { name: '选集，共 2 集', exact: true }).click();
  const episodes = menu('选择分集');
  const episodeCount = await requests();
  await finish();
  await remain(episodes, episodeCount);
  assert.ok((await episodes.locator('[aria-current="true"]').innerText()).includes('已播完'));
  await episodes.locator('[aria-current="true"]').focus();
  await pressPad(page, 0);
  await episodes.waitFor({ state: 'detached' });
  assert.equal(await requests(), episodeCount);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 0);
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  checks.push('completed current episode is labelled correctly and confirming it replays instead of unexpectedly advancing');

  await page.getByRole('button', { name: '选集，共 2 集', exact: true }).click();
  await finish();
  await episodes.locator('.episode-option').nth(1).focus();
  await pressPad(page, 0);
  await page.waitForFunction(count => window.reliability.resolves.length === count + 1
    && !document.querySelector('video').paused, episodeCount);
  await page.waitForTimeout(100);
  assert.equal(await requests(), episodeCount + 1);
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:2');
  checks.push('an explicit episode choice replaces the deferred automatic action without skipping a part or double resolving');

  await reset();
  await page.getByRole('button', { name: '清晰度', exact: true }).click();
  const quality = menu('清晰度');
  const qualityCount = await requests();
  await finish();
  await remain(quality, qualityCount);
  await quality.locator('[data-option-id="64"]').click();
  await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'false'
    && document.querySelector('[data-player-choice="quality"]')?.dataset.optionValue === '64');
  await page.waitForTimeout(100);
  assert.equal(await requests(), qualityCount + 1);
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:1');
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  checks.push('explicit quality confirmation cancels deferred advance and preserves completed-media pause rather than playing an unwanted next part');

  await reset();
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  const settings = page.getByRole('dialog');
  const settingsCount = await requests();
  await finish();
  await remain(settings, settingsCount);
  await page.getByRole('combobox', { name: '播完后', exact: true }).selectOption('pause');
  await pressPad(page, 1);
  await settings.waitFor({ state: 'detached' });
  await page.waitForTimeout(100);
  assert.equal(await requests(), settingsCount);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByRole('combobox', { name: '播完后', exact: true }).selectOption('next');
  await pressPad(page, 1);
  await page.waitForTimeout(100);
  assert.equal(await requests(), settingsCount);
  checks.push('completion does not close settings; disabling automatic playback cancels the pending action and re-enabling does not resurrect it');

  await page.getByRole('button', { name: '重新播放', exact: true }).click();
  await page.getByRole('button', { name: '播放速度', exact: true }).click();
  const suspendCount = await requests();
  await finish();
  await remain(rate, suspendCount);
  await page.evaluate(() => window.reliability.suspend());
  await pressPad(page, 1);
  await rate.waitFor({ state: 'detached' });
  await page.waitForTimeout(100);
  assert.equal(await requests(), suspendCount);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  checks.push('suspend cancels deferred automatic playback; closing the panel cannot restart after interruption');

  await page.getByRole('button', { name: '重新播放', exact: true }).click();
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  const queue = page.getByRole('dialog');
  const queueCount = await requests();
  await finish();
  await remain(queue, queueCount);
  await pressPad(page, 1);
  await queue.waitFor({ state: 'detached' });
  await page.waitForFunction(count => window.reliability.resolves.length === count + 1
    && !document.querySelector('video').paused, queueCount);
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:2');
  checks.push('queue editing retains its scope through completion and ordinary close resumes the original part-before-queue order');

  await reset();
  await pressPad(page, 7);
  const seekCount = await requests();
  await finish();
  await page.waitForTimeout(100);
  assert.equal(await requests(), seekCount);
  assert.equal(await page.locator('.seek-preview').count(), 1);
  await pressPad(page, 0);
  await page.waitForTimeout(100);
  assert.equal(await requests(), seekCount);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 30);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  checks.push('an unconfirmed seek is preserved at completion; confirming a rewind cancels deferred advance and keeps pause');

  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  await finish();
  await page.waitForFunction(count => window.reliability.resolves.length === count + 1
    && !document.querySelector('video').paused, seekCount);
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:2');
  checks.push('replaying or rewinding re-arms legitimate completion; unblocked automatic playback still advances normally');

  await reset();
  await page.getByRole('button', { name: '播放速度', exact: true }).click();
  const errorCount = await requests();
  await finish();
  await remain(rate, errorCount);
  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
  await page.locator('.player-error').waitFor();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player-error') && !document.querySelector('video').paused);
  assert.equal(await requests(), errorCount + 1);
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:1');
  checks.push('media failure cancels the deferred automatic action and retry remains on the original part');

  await page.getByRole('button', { name: '播放速度', exact: true }).click();
  const cancelCount = await requests();
  await finish();
  await remain(rate, cancelCount);
  await page.evaluate(() => { window.reliability.holdResolve = true; });
  await pressPad(page, 1);
  await rate.waitFor({ state: 'detached' });
  await page.waitForFunction(count => window.reliability.resolves.length === count + 1, cancelCount);
  const late = await page.evaluate(() => window.reliability.resolves.at(-1).sessionId);
  await pressPad(page, 1);
  await pressPad(page, 1);
  await page.waitForFunction(() => !document.querySelector('.player'));
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForFunction(session => window.reliability.releases.includes(session), late);
  assert.equal(await page.locator('.player').count(), 0);
  checks.push('return remains available after deferred advance starts and its late source is released without reopening');

  await page.getByRole('button', { name: '切换电视模式', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tv === 'true');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await play();
  await page.getByRole('button', { name: '选集，共 2 集', exact: true }).focus();
  await pressPad(page, 0);
  const tvCount = await requests();
  await finish();
  await remain(episodes, tvCount);
  assert.equal(await page.locator('.episode-scrim').evaluate(node => getComputedStyle(node).zIndex), '3');
  const hits = await episodes.locator('button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && button.contains(hit);
  }));
  assert.ok(hits.every(Boolean));
  await page.screenshot({ path: resolve(output, 'television-episodes-ended.png'), animations: 'disabled' });
  await pressPad(page, 1);
  await page.waitForFunction(count => window.reliability.resolves.length === count + 1
    && !document.querySelector('video').paused, tvCount);
  checks.push('TV episode completion keeps readable status, reachable actions and focus; ordinary B close advances only once');
  await reset();
  await page.evaluate(() => {
    window.reliability.holdResolve = true;
    const original = window.hub.resolve;
    window.hub.resolve = async (...args) => { await original(...args); throw new Error('清晰度请求失败'); };
  });
  await page.getByRole('button', { name: '清晰度', exact: true }).click();
  await quality.locator('[data-option-id="64"]').click();
  await page.waitForFunction(() => !!window.reliability.finishResolve);
  const failedCount = await requests();
  await finish();
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'false');
  await page.waitForTimeout(100);
  assert.equal(await requests(), failedCount);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  assert.equal(await page.locator('.player').getAttribute('data-ended'), 'true');
  assert.equal(await page.getByRole('button', { name: '重新播放', exact: true }).count(), 1);
  checks.push('completion during a pending manual change remains stopped after request failure; failed-change recovery cannot silently replay or advance');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
