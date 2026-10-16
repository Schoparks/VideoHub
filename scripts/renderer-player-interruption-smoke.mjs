import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { choosePlayerQuality } from './player-test-actions.mjs';

const output = resolve('.tmp/renderer-player-interruption');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const card = page.getByRole('button', { name: '播放 可靠性测试', exact: true });
const quality = page.getByRole('button', { name: '清晰度', exact: true });
const configure = values => page.evaluate(values => Object.assign(window.reliability, values), values);
const suspend = async () => {
  await page.evaluate(() => window.reliability.suspend());
  await page.waitForTimeout(80);
};
const open = async () => {
  await card.click();
  await page.waitForFunction(() => document.querySelector('video')?.paused === false);
};
const exit = async () => {
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
};
const paused = () => page.locator('video').evaluate(video => video.paused);
const switching = () => page.locator('.player').getAttribute('data-switching');
const resolves = () => page.evaluate(() => window.reliability.resolves.length);
const next = () => page.getByRole('button', { name: /^(下一集|播放队列下一项|下一项)$/ }).click();

try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await configure({ holdResolve: true });
  await card.click();
  await page.waitForFunction(() => !!window.reliability.finishResolve);
  await suspend();
  assert.equal(await page.getByRole('button', { name: '取消准备播放', exact: true }).count(), 0);
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForFunction(() => window.reliability.releases.includes(window.reliability.resolves[0].sessionId));
  assert.equal(await page.locator('.player').count(), 0);
  assert.equal(await card.evaluate(node => node === document.activeElement), true);
  checks.push('suspend cancels initial resolve, releases its late source and restores the entry focus');

  await open();
  await page.locator('video').evaluate(video => { video.currentTime = 27.25; });
  await configure({ holdResolve: true, finishResolve: null });
  await choosePlayerQuality(page, 64);
  await page.waitForFunction(() => !!window.reliability.finishResolve);
  await suspend();
  assert.equal(await switching(), 'false');
  assert.equal(await paused(), true);
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForFunction(() => window.reliability.releases.includes(window.reliability.resolves.at(-1).sessionId));
  assert.equal(await quality.getAttribute('data-option-value'), '80');
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 27.25);
  assert.equal(await paused(), true);
  assert.equal(await quality.evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  assert.equal(await paused(), false);
  checks.push('suspend cancels pending quality without replacing or resuming the original video, position or focus');

  await configure({ holdProgress: true });
  const beforeSave = await resolves();
  await next();
  await page.waitForFunction(() => window.reliability.pendingProgress.length > 0);
  await suspend();
  await page.evaluate(() => {
    window.reliability.holdProgress = false;
    window.reliability.pendingProgress.splice(0).forEach(finish => finish());
  });
  await page.waitForTimeout(100);
  assert.equal(await resolves(), beforeSave);
  assert.equal(await switching(), 'false');
  assert.equal(await paused(), true);
  checks.push('suspend during progress save cancels the not-yet-started episode transition');

  await exit();
  await configure({ omitParts: true, holdDetail: true, finishDetail: null });
  await open();
  const beforeDetail = await resolves();
  await next();
  await page.waitForFunction(() => !!window.reliability.finishDetail);
  await suspend();
  await page.evaluate(() => { window.reliability.holdDetail = false; window.reliability.finishDetail(); });
  await page.waitForTimeout(100);
  assert.equal(await resolves(), beforeDetail);
  assert.equal(await switching(), 'false');
  assert.equal(await paused(), true);
  checks.push('suspend invalidates late episode details without creating a new playback request');

  await exit();
  await configure({ omitParts: false, holdResolve: false });
  await open();
  await configure({ holdResolve: true, finishResolve: null });
  await choosePlayerQuality(page, 64);
  await page.waitForFunction(() => !!window.reliability.finishResolve);
  await page.evaluate(() => { window.reliability.oldFinish = window.reliability.finishResolve; });
  await suspend();
  await configure({ finishResolve: null });
  await next();
  await page.waitForFunction(() => !!window.reliability.finishResolve);
  const newCount = await resolves();
  await page.evaluate(() => window.reliability.oldFinish());
  await page.waitForFunction(() => window.reliability.releases.includes(window.reliability.resolves.at(-2).sessionId));
  assert.equal(await switching(), 'true');
  assert.equal(await resolves(), newCount);
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForFunction(() => document.querySelector('.player')?.getAttribute('data-switching') === 'false'
    && document.querySelector('video')?.paused === false);
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:2');
  assert.equal(await quality.getAttribute('data-option-value'), '80');
  checks.push('a new explicit transition works after interruption; the old completion cannot clear its busy state or apply old quality');

  await configure({ holdProgress: true });
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await page.waitForFunction(() => window.reliability.pendingProgress.length > 0);
  await suspend();
  await page.evaluate(() => {
    window.reliability.holdProgress = false;
    window.reliability.pendingProgress.splice(0).forEach(finish => finish());
  });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await paused(), true);
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  assert.equal(await paused(), true);
  checks.push('suspend cancels deferred queue opening; an explicit new queue request still works without resuming video');

  await exit();
  await open();
  await configure({ holdProgress: true });
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await page.waitForFunction(() => window.reliability.pendingProgress.length > 0);
  await next();
  await page.evaluate(() => {
    window.reliability.holdProgress = false;
    window.reliability.pendingProgress.splice(0).forEach(finish => finish());
  });
  await page.waitForFunction(() => window.reliability.resolves.at(-1).part === 'cid:2'
    && document.querySelector('.player')?.getAttribute('data-switching') === 'false');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await paused(), false);
  checks.push('a newer episode transition cancels an older deferred queue opener instead of showing it over the new video');

  await configure({ holdProgress: true });
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await page.waitForFunction(() => window.reliability.pendingProgress.length > 0);
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  const setting = page.getByRole('switch', { name: '深色外观', exact: true });
  await setting.focus();
  await page.evaluate(() => {
    window.reliability.holdProgress = false;
    window.reliability.pendingProgress.splice(0).forEach(finish => finish());
  });
  await page.waitForTimeout(100);
  assert.equal(await setting.isVisible(), true);
  assert.equal(await setting.evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  checks.push('a deferred queue request cannot replace a newer settings dialog or steal its focused control');

  await configure({ holdProgress: true });
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await page.waitForFunction(() => window.reliability.pendingProgress.length > 0);
  await page.getByRole('button', { name: '播放速度', exact: true }).click();
  await page.getByRole('dialog', { name: '播放速度', exact: true }).getByRole('button', { name: '关闭播放速度', exact: true }).click();
  await page.evaluate(() => {
    window.reliability.holdProgress = false;
    window.reliability.pendingProgress.splice(0).forEach(finish => finish());
  });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByRole('button', { name: '播放速度', exact: true }).evaluate(node => node === document.activeElement), true);
  checks.push('opening and closing a parameter menu invalidates an older queue request even after the overlay is gone');
  await exit();
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
