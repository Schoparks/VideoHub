import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-paused-quality');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const quality = page.getByRole('button', { name: '清晰度', exact: true });
const choose = async value => {
  await quality.focus();
  await pressPad(page, 0);
  await page.getByRole('dialog', { name: '清晰度', exact: true }).locator(`[data-option-id="${value}"]`).focus();
  await pressPad(page, 0);
};
const settled = async value => {
  await page.waitForFunction(value => document.querySelector('[aria-label="清晰度"]')?.getAttribute('data-option-value') === String(value)
    && document.querySelector('.player')?.getAttribute('data-switching') === 'false', value);
  await page.waitForTimeout(100);
};

try {
  await page.evaluate(() => {
    window.qualityAudit = { plays: 0, fail: false, fallback: false };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.qualityAudit.plays++; return play.call(this); };
    const resolve = window.hub.resolve;
    window.hub.resolve = async (...args) => {
      if (window.qualityAudit.fail) { window.qualityAudit.fail = false; throw new Error('清晰度请求失败'); }
      const source = await resolve(...args);
      if (window.qualityAudit.fallback) { window.qualityAudit.fallback = false; source.quality = 80; }
      return source;
    };
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('video') && !document.querySelector('video').paused);
  await connectPad(page);
  await pressPad(page, 9);
  await page.locator('video').evaluate(video => { video.currentTime = 31.25; });
  const playCount = await page.evaluate(() => window.qualityAudit.plays);
  await choose(64);
  await settled(64);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  assert.equal(await page.evaluate(() => window.qualityAudit.plays), playCount);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 31.25);
  assert.equal(await quality.evaluate(node => document.activeElement === node), true);
  await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
  checks.push('paused quality replacement never calls play and retains position, state and opener focus');

  await page.evaluate(() => { window.reliability.holdResolve = true; });
  await choose(80);
  await page.waitForFunction(() => !!window.reliability.finishResolve);
  await pressPad(page, 9);
  assert.equal(await page.evaluate(() => window.qualityAudit.plays), playCount);
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await settled(80);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  assert.equal(await page.evaluate(() => window.qualityAudit.plays), playCount);
  checks.push('slow paused replacement blocks conflicting playback and remains paused after loading');

  await page.evaluate(() => { window.qualityAudit.fail = true; });
  await choose(64);
  await page.getByRole('status').filter({ hasText: '清晰度请求失败' }).waitFor();
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  assert.equal(await quality.getAttribute('data-option-value'), '80');
  assert.equal(await page.evaluate(() => window.qualityAudit.plays), playCount);
  checks.push('failed paused quality replacement leaves the original media paused');

  await page.evaluate(() => { window.qualityAudit.fallback = true; });
  await choose(64);
  await settled(80);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  assert.equal(await page.evaluate(() => window.qualityAudit.plays), playCount);
  assert.equal(await quality.evaluate(node => document.activeElement === node), true);
  checks.push('server-returned quality remains authoritative while paused state and focus survive negotiation');

  await pressPad(page, 9);
  await page.waitForFunction(() => !document.querySelector('video').paused);
  await choose(64);
  await settled(64);
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 31.25);
  await page.evaluate(() => { window.qualityAudit.fail = true; });
  await choose(80);
  await page.getByRole('status').filter({ hasText: '清晰度请求失败' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('video').paused);
  checks.push('playing quality replacement continues playback; a failed replacement resumes the original media');

  await pressPad(page, 9);
  await page.evaluate(() => { window.qualityAudit.fail = true; });
  await choose(80);
  await page.waitForFunction(() => document.querySelector('.player')?.getAttribute('data-switching') === 'false');
  await pressPad(page, 5);
  await page.waitForFunction(() => document.querySelector('.player-overlay header p')?.textContent?.includes('测试第 2 集')
    && !document.querySelector('video').paused);
  checks.push('a later explicit episode change starts playback and cannot inherit a failed quality pause intent');

  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
