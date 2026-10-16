import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-player-busy-focus');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const next = page.locator('[data-player-action="next"]');
  const previous = page.locator('[data-player-action="previous"]');
  const focused = locator => locator.evaluate(node => node === document.activeElement);
  const idle = () => page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'false');
  const start = async (button, fail = true) => {
    await page.evaluate(fail => {
      window.reliability.holdResolve = true;
      window.reliability.finishResolve = null;
      window.reliability.failSwitch = fail;
    }, fail);
    await button.focus();
    await pressPad(page, 0);
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    await page.waitForTimeout(150);
  };
  const finish = async () => {
    await page.evaluate(() => {
      window.reliability.holdResolve = false;
      window.reliability.finishResolve();
    });
    await idle();
  };
  try {
    await page.evaluate(tv => {
      const state = window.reliability;
      state.boot.preferences.tvMode = tv;
      state.boot.queue = [];
      const resolve = window.hub.resolve;
      window.hub.resolve = async (...args) => {
        const source = await resolve(...args);
        if (state.failSwitch) throw new Error('切集读取失败');
        return source;
      };
      const detail = window.hub.detail;
      window.hub.detail = async (...args) => {
        state.discoveryCalls = (state.discoveryCalls || 0) + 1;
        const result = await detail(...args);
        if (state.failDiscovery) throw new Error('分集读取失败');
        return result;
      };
    }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.locator('video').evaluate(video => { video.currentTime = 31.25; });
    await connectPad(page);
    await start(next);
    const observation = await next.evaluate(button => ({
      focused: button === document.activeElement, disabled: button.disabled,
      ariaDisabled: button.getAttribute('aria-disabled'),
      currentFocus: document.activeElement?.getAttribute('aria-label'),
      hints: document.querySelector('.player-hints').innerText,
    }));
    await writeFile(resolve(output, `${mode}-pending.json`), JSON.stringify(observation));
    assert.equal(observation.focused, true);
    assert.equal(observation.ariaDisabled, 'true');
    assert.equal(observation.hints.includes('确认'), false);
    checks.push(`${mode}: a pending episode action keeps its controller focus and omits unavailable confirmation guidance`);

    const requests = await page.evaluate(() => window.reliability.resolves.length);
    const saves = await page.evaluate(() => window.reliability.progress.length);
    await pressPad(page, 0);
    await pressPad(page, 5);
    await page.keyboard.press('Enter');
    await next.evaluate(button => button.click());
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), requests);
    assert.equal(await page.evaluate(() => window.reliability.progress.length), saves);
    await finish();
    assert.equal(await focused(next), true);
    assert.equal(await next.isDisabled(), false);
    assert.deepEqual(await page.locator('video').evaluate(video => ({ paused: video.paused, position: video.currentTime })),
      { paused: true, position: 31.25 });
    checks.push(`${mode}: duplicate controller, keyboard and pointer confirmation cannot submit while busy; failed switching preserves the retry entry and media`);

    await start(next);
    await pressPad(page, 15);
    const speed = page.getByRole('button', { name: '播放速度', exact: true });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放速度');
    await finish();
    assert.equal(await focused(speed), true);
    checks.push(`${mode}: users can move away while waiting and a failed action does not restore an obsolete focus`);

    await page.getByRole('button', { name: '继续播放', exact: true }).click();
    await start(next);
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    await finish();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    assert.equal(await focused(next), true);
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 31.25);
    checks.push(`${mode}: a failed episode change restores the original playing intent without losing its focused retry action`);

    await start(next, false);
    await page.screenshot({ path: resolve(output, `${mode}-pending.png`) });
    await finish();
    await page.waitForFunction(() => window.reliability.resolves.at(-1).part === 'cid:2');
    assert.equal(await next.isDisabled(), true);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.locator('video').evaluate(video => { video.currentTime = 18.5; });
    await start(previous);
    assert.equal(await focused(previous), true);
    assert.equal(await previous.getAttribute('aria-disabled'), 'true');
    await finish();
    assert.equal(await focused(previous), true);
    assert.equal(await previous.isDisabled(), false);
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 18.5);
    checks.push(`${mode}: previous-episode waits and failures keep the original focus; permanent no-successor next stays disabled`);
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));

    await page.evaluate(() => {
      window.reliability.omitParts = true;
      window.reliability.failSwitch = false;
      window.reliability.holdDetail = true;
      window.reliability.failDiscovery = true;
      window.reliability.finishDetail = null;
    });
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await next.focus();
    await pressPad(page, 0);
    await page.waitForFunction(() => !!window.reliability.finishDetail);
    await page.waitForTimeout(150);
    assert.equal(await focused(next), true);
    assert.equal(await next.getAttribute('aria-disabled'), 'true');
    await pressPad(page, 0);
    await next.evaluate(button => button.click());
    assert.equal(await page.evaluate(() => window.reliability.discoveryCalls), 1);
    await page.evaluate(() => {
      window.reliability.holdDetail = false;
      window.reliability.finishDetail();
    });
    await idle();
    assert.equal(await focused(next), true);
    assert.equal(await next.isDisabled(), false);
    assert.equal(await next.getAttribute('aria-label'), '下一项');
    checks.push(`${mode}: unknown episode discovery keeps focus through waiting/failure and rejects repeated reads`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
