import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';
import { choosePlayerQuality } from './player-test-actions.mjs';

const output = resolve('.tmp/renderer-loading-pause');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const ready = () => page.waitForFunction(() => window.pauseAudit.metadata.length > 0);
const release = () => page.evaluate(() => window.pauseAudit.metadata.shift()());
const plays = () => page.evaluate(() => window.pauseAudit.plays);
const paused = () => page.locator('video').evaluate(video => video.paused);
const open = async () => {
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await ready();
};
const exit = async () => {
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
};

try {
  await page.evaluate(() => {
    window.pauseAudit = { metadata: [], plays: 0 };
    const dispatch = HTMLMediaElement.prototype.dispatchEvent;
    HTMLMediaElement.prototype.dispatchEvent = function (event) {
      if (event.type === 'loadedmetadata') {
        window.pauseAudit.metadata.push(() => dispatch.call(this, event));
        return true;
      }
      return dispatch.call(this, event);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.pauseAudit.plays++;
      if (window.pauseAudit.fail) {
        window.pauseAudit.fail = false;
        return Promise.reject(new Error('播放请求失败'));
      }
      const result = play.call(this);
      if (window.pauseAudit.defer) {
        window.pauseAudit.defer = false;
        return new Promise((_resolve, reject) => { window.pauseAudit.rejectPlay = reject; });
      }
      return result;
    };
    window.hub.onSuspend = listener => {
      window.pauseAudit.suspend = listener;
      return () => { window.pauseAudit.suspend = undefined; };
    };
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await open();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  assert.equal(await plays(), 0, 'pause before metadata must not call play');
  await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
  await release();
  assert.equal(await paused(), true);
  assert.equal(await plays(), 0);
  checks.push('initial loading pause updates the control and survives metadata without calling play');

  await exit();
  await open();
  await connectPad(page);
  await pressPad(page, 9);
  await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await pressPad(page, 9);
  await release();
  assert.equal(await paused(), true);
  assert.equal(await plays(), 0);
  await pressPad(page, 9);
  assert.equal(await paused(), false);
  assert.equal(await plays(), 1);
  checks.push('Start and Space use the last loading intent, then explicit continue starts playback');

  await choosePlayerQuality(page, 64);
  await ready();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await choosePlayerQuality(page, 80);
  await ready();
  await release();
  await release();
  assert.equal(await paused(), true);
  assert.equal(await plays(), 1);
  checks.push('pause during quality loading survives another replacement and stale metadata');

  await exit();
  await open();
  await page.evaluate(() => window.pauseAudit.suspend());
  await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
  await release();
  assert.equal(await paused(), true);
  assert.equal(await plays(), 1);
  checks.push('system suspend during loading prevents later automatic playback');

  await exit();
  await open();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.player').count(), 1);
  assert.equal(await page.locator('.player.controls-visible').count(), 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.player'));
  await release();
  assert.equal(await page.locator('.player').count(), 0);
  assert.equal(await plays(), 1);
  checks.push('B/Escape hides loading controls first, then exits; late metadata cannot restart playback');

  await open();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  assert.equal(await plays(), 1);
  await release();
  assert.equal(await paused(), false);
  assert.equal(await plays(), 2);
  checks.push('pause then continue during loading starts once when metadata is ready');

  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.locator('video').evaluate(video => { void video.play(); });
  assert.equal(await paused(), true);
  await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
  checks.push('a late native playing event cannot override an explicit pause intent');
  await page.evaluate(() => { window.pauseAudit.defer = true; });
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.evaluate(() => window.pauseAudit.rejectPlay(new DOMException('Paused by user', 'AbortError')));
  await page.waitForTimeout(80);
  assert.equal(await page.locator('.player-error').count(), 0);
  assert.equal(await paused(), true);
  await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
  checks.push('a pending play rejection after explicit pause cannot report an error or change the latest state');

  await page.evaluate(() => { window.pauseAudit.fail = true; });
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  await page.locator('.player-error').filter({ hasText: '播放请求失败' }).waitFor();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await ready();
  await release();
  assert.equal(await paused(), false);
  assert.equal(await page.locator('.player-error').count(), 0);
  checks.push('a current play failure remains visible and retry reparses and starts a fresh session');

  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.evaluate(() => { window.pauseAudit.defer = true; });
  await page.getByRole('button', { name: '继续播放', exact: true }).click();
  await choosePlayerQuality(page, 64);
  await ready();
  await release();
  await page.evaluate(() => window.pauseAudit.rejectPlay(new Error('旧会话播放失败')));
  await page.waitForTimeout(80);
  assert.equal(await paused(), false);
  assert.equal(await page.locator('.player-error').count(), 0);
  checks.push('a replaced session play rejection cannot pause or report an error in the current quality');
  await exit();
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
