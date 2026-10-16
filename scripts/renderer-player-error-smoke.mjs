import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';
import { choosePlayerQuality } from './player-test-actions.mjs';

const output = resolve('.tmp/renderer-player-error');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const ready = () => page.waitForFunction(() => window.errorAudit.metadata.length > 0);
const release = () => page.evaluate(() => window.errorAudit.metadata.shift()());
const plays = () => page.evaluate(() => window.errorAudit.plays);
const paused = () => page.locator('video').evaluate(video => video.paused);
const fail = async () => {
  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
  await page.locator('.player-error').waitFor();
};
const retry = async () => {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await ready();
  await release();
  await page.waitForFunction(() => document.querySelector('video')?.paused === false && !document.querySelector('.player-error'));
};

try {
  await page.evaluate(() => {
    window.reliability.boot.preferences.autoNext = true;
    window.errorAudit = { metadata: [], plays: 0 };
    const dispatch = HTMLMediaElement.prototype.dispatchEvent;
    HTMLMediaElement.prototype.dispatchEvent = function (event) {
      if (event.type === 'loadedmetadata') {
        window.errorAudit.metadata.push(() => dispatch.call(this, event));
        return true;
      }
      return dispatch.call(this, event);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.errorAudit.plays++;
      if (window.errorAudit.failPlay) {
        window.errorAudit.failPlay = false;
        return Promise.reject(new DOMException('Unsupported media', 'NotSupportedError'));
      }
      if (window.errorAudit.blockPlay) {
        window.errorAudit.blockPlay = false;
        return Promise.reject(new DOMException('User gesture required', 'NotAllowedError'));
      }
      return play.call(this);
    };
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await ready();
  await fail();
  await release();
  assert.equal(await paused(), true, 'late metadata after failure must not start playback');
  assert.equal(await plays(), 0);
  assert.equal(await page.locator('.player').getAttribute('data-paused'), 'true');
  checks.push('failure before metadata revokes autoplay; late metadata cannot start a video behind its error page');

  await retry();
  await page.locator('video').evaluate(video => { video.currentTime = 38.75; });
  await page.locator('video').evaluate(video => {
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 2 } });
  });
  await fail();
  assert.ok((await page.locator('.player-error').innerText()).includes('MEDIA 2'));
  await page.locator('video').evaluate(video => { delete video.error; });
  assert.equal(await paused(), true);
  await page.waitForFunction(() => window.reliability.progress.some(entry => entry.position === 38.75));
  assert.equal(await page.getByRole('button', { name: '重试', exact: true }).evaluate(node => node === document.activeElement), true);
  checks.push('active media failure stops playback, saves the exact position and focuses a usable retry');

  const beforeLate = await page.evaluate(() => window.reliability.resolves.length);
  await page.locator('video').evaluate(video => {
    void video.play();
    video.dispatchEvent(new Event('ended'));
  });
  await page.waitForTimeout(100);
  assert.equal(await paused(), true);
  assert.equal(await page.evaluate(() => window.reliability.resolves.length), beforeLate);
  await connectPad(page);
  await pressPad(page, 9);
  assert.equal(await paused(), true);
  checks.push('late playing/ended events cannot resume failed media or automatically advance the queue, and Start stays isolated');

  await retry();
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 38.75);
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:1');
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).quality), 80);
  checks.push('retry creates a fresh session for the same part/quality and keeps the exact failure position');

  await page.getByRole('button', { name: '选集，共 2 集', exact: true }).click();
  await page.getByRole('dialog', { name: '选择分集', exact: true }).waitFor();
  await fail();
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByRole('button', { name: '重试', exact: true }).evaluate(node => node === document.activeElement), true);
  checks.push('failure closes the episode panel so retry/return are visible and receive focus');

  await retry();
  await pressPad(page, 7);
  assert.equal(await page.locator('.seek-preview').count(), 1);
  await fail();
  assert.equal(await page.locator('.seek-preview').count(), 0);
  await pressPad(page, 1);
  await page.waitForFunction(() => !document.querySelector('.player'));
  assert.equal(await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).evaluate(node => node === document.activeElement), true);
  checks.push('failure cancels seek preview; B returns directly and restores the original card');

  await page.evaluate(() => { window.errorAudit.failPlay = true; });
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await ready();
  await release();
  await page.locator('.player-error').waitFor();
  assert.ok((await page.locator('.player-error').innerText()).includes('此设备无法播放当前媒体'));
  assert.equal(await paused(), true);
  await retry();
  checks.push('an unsupported autoplay rejection produces a recoverable error instead of a misleading continue state');

  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  await page.evaluate(() => { window.errorAudit.blockPlay = true; });
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await ready();
  await release();
  await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
  assert.equal(await page.locator('.player-error').count(), 0);
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  assert.equal(await paused(), false);
  checks.push('autoplay permission rejection remains a usable continue action and explicit playback still works');

  await page.locator('video').evaluate(video => { video.currentTime = 51.5; });
  await page.evaluate(() => {
    window.reliability.holdResolve = true;
    window.reliability.finishResolve = undefined;
    const resolve = window.hub.resolve;
    window.hub.resolve = async (...args) => {
      await resolve(...args);
      throw new Error('清晰度请求失败');
    };
  });
  const beforeQualityFailure = await plays();
  await choosePlayerQuality(page, 64);
  await page.waitForFunction(() => !!window.reliability.finishResolve);
  await fail();
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForFunction(() => document.querySelector('.player')?.getAttribute('data-switching') === 'false');
  await page.waitForTimeout(100);
  assert.equal(await paused(), true);
  assert.equal(await plays(), beforeQualityFailure);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 51.5);
  assert.equal(await page.locator('.player-error').count(), 1);
  checks.push('a failed quality request cannot resume an original session that failed while the replacement was pending');
  await page.getByRole('button', { name: '返回浏览', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
