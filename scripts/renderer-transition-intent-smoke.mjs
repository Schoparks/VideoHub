import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { choosePlayerQuality } from './player-test-actions.mjs';

const output = resolve('.tmp/renderer-transition-intent');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const viewport = tv ? { width: 1920, height: 1080 } : { width: 1440, height: 950 };
  const { page, errors, close } = await launchHeadlessRenderer(viewport, installReliabilityFixture);
  const paused = () => page.locator('video').evaluate(video => video.paused);
  const waitPaused = value => page.waitForFunction(value => document.querySelector('video')?.paused === value,
    value, { polling: 50 });
  try {
    await page.getByRole('button', { name: '重试', exact: true }).click();
    if (tv) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('switch', { name: '电视模式', exact: true }).click();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await waitPaused(false);
    await page.locator('video').evaluate(video => { video.currentTime = 31.25; });
    await page.evaluate(() => {
      window.intentAudit = { failure: false, queued: [], originalFrame: window.requestAnimationFrame, plays: 0 };
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        window.intentAudit.plays++;
        return play.call(this);
      };
      const resolve = window.hub.resolve;
      window.hub.resolve = async (...args) => {
        const source = await resolve(...args);
        if (window.intentAudit.failure) throw new Error('清晰度请求失败');
        return source;
      };
    });
    const failQuality = async () => {
      await page.evaluate(() => {
        window.reliability.holdResolve = true;
        window.reliability.finishResolve = null;
        window.intentAudit.failure = true;
      });
      await choosePlayerQuality(page, 64);
      await page.waitForFunction(() => !!window.reliability.finishResolve);
      await page.evaluate(() => {
        window.requestAnimationFrame = callback => {
          window.intentAudit.queued.push(callback);
          return -window.intentAudit.queued.length;
        };
        window.reliability.holdResolve = false;
        window.reliability.finishResolve();
      });
      await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'false',
        undefined, { polling: 50 });
      assert.equal(await paused(), true);
    };
    const releaseFrames = async () => {
      await page.evaluate(() => {
        window.requestAnimationFrame = window.intentAudit.originalFrame;
        for (const callback of window.intentAudit.queued.splice(0)) window.requestAnimationFrame(callback);
      });
      await page.waitForTimeout(120);
    };

    await failQuality();
    await page.keyboard.press('Space');
    await waitPaused(false);
    await page.keyboard.press('Space');
    await waitPaused(true);
    await releaseFrames();
    assert.equal(await paused(), true, 'failed transition must not override a newer explicit pause');
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 31.25);
    assert.equal(await page.getByRole('button', { name: '清晰度', exact: true }).getAttribute('data-option-value'), '80');
    checks.push(`${tv ? 'TV' : 'desktop'}: failure recovery cannot override explicit continue then pause before the next frame`);

    await page.keyboard.press('Space');
    await waitPaused(false);
    await failQuality();
    await releaseFrames();
    await waitPaused(false);
    checks.push(`${tv ? 'TV' : 'desktop'}: an unchanged playing intent still resumes the original source after failure`);

    await failQuality();
    await page.keyboard.press('Space');
    await waitPaused(false);
    const plays = await page.evaluate(() => window.intentAudit.plays);
    await releaseFrames();
    assert.equal(await paused(), false);
    assert.equal(await page.evaluate(() => window.intentAudit.plays), plays);
    checks.push(`${tv ? 'TV' : 'desktop'}: explicit continue replaces the delayed recovery without a duplicate play call`);

    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    assert.deepEqual(errors, []);
  } finally {
    await page.evaluate(() => {
      if (window.intentAudit) window.requestAnimationFrame = window.intentAudit.originalFrame;
    }).catch(() => {});
    await close();
  }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, simulatedMedia: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
