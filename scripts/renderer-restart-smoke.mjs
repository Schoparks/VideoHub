import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-restart');
await mkdir(output, { recursive: true });
const checks = [], failures = [];
for (const tvMode of [false, true]) {
  for (const scenario of ['completed', 'loading']) {
    const { page, errors, close } = await launchHeadlessRenderer(tvMode
      ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
    const label = `${tvMode ? 'TV' : 'desktop'} / ${scenario}`;
    const state = () => page.locator('video').evaluate(video => ({
      paused: video.paused, position: video.currentTime, rate: video.playbackRate,
      requests: window.reliability.resolves.length, plays: window.restartAudit.plays,
    }));
    const open = async () => {
      await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
      if (scenario === 'loading') await page.waitForFunction(() => window.restartAudit.metadata.length > 0);
      else await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    };
    const exit = async () => {
      await page.getByRole('button', { name: '退出播放', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.player'));
    };
    const release = () => page.evaluate(() => window.restartAudit.metadata.shift()());
    try {
      await page.evaluate(({ tvMode, scenario }) => {
        window.reliability.boot.preferences.tvMode = tvMode;
        window.reliability.boot.preferences.playbackRate = 2;
        const audit = window.restartAudit = { plays: 0, metadata: [] };
        const resolve = window.hub.resolve;
        window.hub.resolve = async (...args) => ({ ...await resolve(...args), startAt: 42.25 });
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () { audit.plays++; return play.call(this); };
        const dispatch = HTMLMediaElement.prototype.dispatchEvent;
        HTMLMediaElement.prototype.dispatchEvent = function (event) {
          if (scenario === 'loading' && event.type === 'loadedmetadata') {
            audit.metadata.push(() => dispatch.call(this, event));
            return true;
          }
          return dispatch.call(this, event);
        };
      }, { tvMode, scenario });
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await open();
      await connectPad(page);
      if (scenario === 'completed') {
        await page.locator('video').evaluate(video => {
          video.currentTime = video.duration;
          video.dispatchEvent(new Event('ended'));
        });
        await page.getByRole('button', { name: '重新播放', exact: true }).waitFor();
        const before = await state();
        await pressPad(page, 4);
        const replay = await state();
        assert.equal(replay.paused, false, 'LB replay must start a completed first part');
        assert.equal(replay.position, 0);
        assert.equal(replay.rate, 2);
        assert.equal(replay.requests, before.requests);
        assert.equal(replay.plays, before.plays + 1);
        assert.equal(await page.locator('.player').getAttribute('data-ended'), 'false');
        checks.push(`${label}: LB replays the completed first part in the same session, at zero and the current rate`);

        await page.getByRole('button', { name: '暂停', exact: true }).click();
        await page.locator('video').evaluate(video => { video.currentTime = 37.25; });
        await page.getByRole('button', { name: '从头播放', exact: true }).click();
        const pointer = await state();
        assert.equal(pointer.paused, false);
        assert.equal(pointer.position, 0);
        assert.equal(pointer.requests, before.requests);
        checks.push(`${label}: the explicit pointer restart also plays a paused video instead of only rewinding it`);

        await page.locator('video').evaluate(video => { video.currentTime = 19.5; });
        await page.getByRole('button', { name: '播放速度', exact: true }).click();
        const editing = await state();
        await pressPad(page, 4);
        assert.deepEqual(await state(), editing);
        await pressPad(page, 1);
        await page.getByRole('button', { name: '从头播放', exact: true }).focus();
        await page.keyboard.press('Enter');
        assert.equal((await state()).position, 0);
        assert.equal((await state()).paused, false);
        checks.push(`${label}: menu LB stays isolated; Enter on restart performs the same explicit action`);
        await page.screenshot({ path: resolve(output, tvMode ? 'television.png' : 'desktop.png') });
      } else {
        await pressPad(page, 9);
        await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
        const before = await state();
        await pressPad(page, 4);
        await release();
        const replay = await state();
        assert.equal(replay.position, 0, 'loading replay must replace the old resume position');
        assert.equal(replay.paused, false);
        assert.equal(replay.rate, 2);
        assert.equal(replay.requests, before.requests);
        assert.equal(replay.plays, before.plays + 1);
        checks.push(`${label}: replay before metadata overrides the saved resume point and starts only when metadata is ready`);

        await exit();
        await open();
        await pressPad(page, 9);
        await release();
        assert.equal((await state()).position, 42.25);
        assert.equal((await state()).paused, true);
        checks.push(`${label}: a new opening retains its ordinary resume point and loading pause without inheriting the old rewind`);

        await exit();
        await open();
        await pressPad(page, 9);
        await pressPad(page, 4);
        await pressPad(page, 9);
        const paused = await state();
        await release();
        assert.equal((await state()).position, 0);
        assert.equal((await state()).paused, true);
        assert.equal((await state()).plays, paused.plays);
        checks.push(`${label}: a later loading pause still wins after an explicit rewind, without starting playback`);
      }
      await exit();
      assert.deepEqual(errors, []);
    } catch (error) { failures.push(`${label}: ${error.message}`); }
    finally { await close(); }
  }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, failures }, null, 2));
console.log(JSON.stringify({ checks, failures }, null, 2));
assert.deepEqual(failures, []);
