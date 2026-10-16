import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

const output = resolve('.tmp/renderer-loading-rate');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const speed = page.getByRole('button', { name: '播放速度', exact: true });
const chooseRate = async value => {
  await speed.click();
  const menu = page.getByRole('dialog', { name: '播放速度', exact: true });
  await menu.locator(`[data-option-id="${value}"]`).click();
  await menu.waitFor({ state: 'detached' });
};
const metadataReady = () => page.waitForFunction(() => window.rateAudit.metadata.length > 0);
const releaseMetadata = () => page.evaluate(() => window.rateAudit.metadata.shift()());
const actualRate = () => page.locator('video').evaluate(video => video.playbackRate);
const chooseQuality = async value => {
  await page.getByRole('button', { name: '清晰度', exact: true }).click();
  await page.getByRole('dialog', { name: '清晰度', exact: true }).locator(`[data-option-id="${value}"]`).click();
  await page.waitForFunction(() => document.querySelector('.player')?.getAttribute('data-switching') === 'false');
  await metadataReady();
};

try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.evaluate(() => {
    window.rateAudit = { metadata: [], plays: [] };
    const dispatch = HTMLMediaElement.prototype.dispatchEvent;
    HTMLMediaElement.prototype.dispatchEvent = function (event) {
      if (event.type === 'loadedmetadata') {
        window.rateAudit.metadata.push(() => dispatch.call(this, event));
        return true;
      }
      return dispatch.call(this, event);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.rateAudit.plays.push(this.playbackRate);
      return play.call(this);
    };
  });
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await metadataReady();
  await chooseRate(1.5);
  await chooseRate(2);
  assert.equal(await speed.getAttribute('data-option-value'), '2');
  assert.equal(await page.evaluate(() => window.rateAudit.plays.length), 0);
  await releaseMetadata();
  assert.equal(await actualRate(), 2);
  assert.deepEqual(await page.evaluate(() => window.rateAudit.plays), [2]);
  checks.push('initial loading uses the latest confirmed speed when metadata arrives and playback begins');

  await page.locator('video').evaluate(video => { video.currentTime = 23.75; });
  await chooseQuality(64);
  await chooseRate(.75);
  await releaseMetadata();
  assert.equal(await actualRate(), .75);
  assert.equal(await speed.getAttribute('data-option-value'), '0.75');
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 23.75);
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  checks.push('changing speed during quality loading retains the new speed and the exact resume position');

  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const plays = await page.evaluate(() => window.rateAudit.plays.length);
  await chooseQuality(80);
  await chooseRate(1.25);
  await releaseMetadata();
  assert.equal(await actualRate(), 1.25);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  assert.equal(await page.evaluate(() => window.rateAudit.plays.length), plays);
  assert.equal(await page.locator('video').evaluate(video => video.volume), 1);
  checks.push('paused quality loading applies the latest rate without starting playback or changing the fixed output gain');

  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('1.5');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  assert.equal(await actualRate(), 1.25);
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await metadataReady();
  await releaseMetadata();
  assert.equal(await actualRate(), 1.5);
  assert.equal(await speed.getAttribute('data-option-value'), '1.5');
  checks.push('the default rate applies on the next opened player and does not overwrite the current temporary selection');
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
