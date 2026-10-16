import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-next-availability');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  try {
    await page.evaluate(tv => {
      window.reliability.boot.preferences.tvMode = tv;
      window.reliability.boot.preferences.autoNext = true;
      window.reliability.followingQueue = structuredClone(window.reliability.boot.queue);
      window.reliability.boot.queue = [];
    }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await connectPad(page);
    await page.evaluate(() => {
      const state = window.reliability.nextProbe = { pressedSamples: 0, actions: [], samples: [] };
      const getPads = navigator.getGamepads.bind(navigator);
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
        const pads = getPads();
        if (pads[0]?.buttons[5].pressed) {
          state.pressedSamples++;
          state.samples.push({ focus: document.hasFocus(), hidden: document.hidden });
        }
        return pads;
      } });
      document.addEventListener('hub-input-action', event => state.actions.push(event.detail));
    });
    await pressPad(page, 5);
    await writeFile(resolve(output, `${mode}-first-rb.json`), JSON.stringify(await page.evaluate(() => ({
      ...window.reliability.nextProbe, resolves: window.reliability.resolves,
      next: document.querySelector('[data-player-action="next"]')?.getAttribute('aria-label'),
      switching: document.querySelector('.player')?.dataset.switching,
    }))));
    await page.waitForFunction(() => window.reliability.resolves.at(-1).part === 'cid:2'
      && document.querySelector('.player')?.dataset.switching === 'false');
    const next = page.locator('[data-player-action="next"]');
    const observation = await next.evaluate(button => ({
      disabled: button.disabled, label: button.getAttribute('aria-label'),
      hints: document.querySelector('.player-hints').innerText,
    }));
    await writeFile(resolve(output, `${mode}-last.json`), JSON.stringify(observation));
    assert.equal(observation.disabled, true);
    assert.equal(observation.hints.includes('播放队列下一项'), false);
    checks.push(`${mode}: a known final episode without a following queue item has no enabled next action or shortcut hint`);
    await page.getByRole('button', { name: '上一集', exact: true }).focus();
    await pressPad(page, 15);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放速度');
    await page.screenshot({ path: resolve(output, `${mode}-last.png`) });
    checks.push(`${mode}: controller navigation skips the disabled next button and reaches a usable parameter control`);

    await page.locator('video').evaluate(video => {
      window.reliability.invalidNextEvents = [];
      for (const type of ['pause', 'playing']) video.addEventListener(type, () => window.reliability.invalidNextEvents.push(type));
    });
    const count = await page.evaluate(() => window.reliability.resolves.length);
    const saves = await page.evaluate(() => window.reliability.progress.length);
    await pressPad(page, 5);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), count);
    assert.equal(await page.evaluate(() => window.reliability.progress.length), saves);
    assert.deepEqual(await page.evaluate(() => window.reliability.invalidNextEvents), []);
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    checks.push(`${mode}: unavailable RB does not pause/resume, save progress or resolve another source`);

    await page.locator('video').evaluate(video => video.dispatchEvent(new Event('ended')));
    await page.waitForFunction(() => document.querySelector('.player')?.dataset.ended === 'true');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), count);
    assert.equal(await page.locator('.toast').count(), 0);
    assert.equal(await next.isDisabled(), true);
    await page.getByRole('button', { name: '重新播放', exact: true }).click();
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 0);
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    checks.push(`${mode}: automatic completion with no successor keeps completed state and allows same-session replay without a last-item toast`);

    await page.evaluate(() => { window.reliability.boot.queue = window.reliability.followingQueue; });
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await pressPad(page, 5);
    await page.waitForFunction(() => window.reliability.resolves.at(-1).part === 'cid:2'
      && document.querySelector('.player')?.dataset.switching === 'false');
    assert.equal(await next.isDisabled(), false);
    assert.equal(await next.getAttribute('aria-label'), '播放队列下一项');
    await pressPad(page, 5);
    await page.waitForFunction(() => document.querySelector('.player-overlay h2')?.textContent === '另一项');
    checks.push(`${mode}: a real following queue item stays enabled and is reached after finishing the original episodes`);

    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    await page.evaluate(() => { window.reliability.omitParts = true; });
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    assert.equal(await next.isDisabled(), false);
    assert.equal(await next.getAttribute('aria-label'), '下一项');
    await page.evaluate(() => { window.reliability.holdDetail = true; });
    await pressPad(page, 5);
    await page.waitForFunction(() => !!window.reliability.finishDetail);
    assert.equal(await next.isDisabled(), true);
    await page.evaluate(() => { window.reliability.holdDetail = false; window.reliability.finishDetail(); });
    await page.waitForFunction(() => window.reliability.resolves.at(-1).part === 'cid:2'
      && document.querySelector('.player')?.dataset.switching === 'false');
    assert.equal(await page.locator('.player-overlay h2').innerText(), '可靠性测试');
    checks.push(`${mode}: unknown episode data stays actionable, waits for actual detail and preserves episode-first succession`);

    await page.evaluate(() => { window.reliability.boot.queue = []; });
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    await page.evaluate(() => {
      const original = window.hub.resolve;
      window.hub.resolve = async (...args) => ({ ...await original(...args), live: true, part: undefined, parts: undefined });
    });
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    assert.equal(await next.isDisabled(), true);
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('.player-hints').innerText().then(text => /播放队列下一项/.test(text)), false);
    const liveCount = await page.evaluate(() => window.reliability.resolves.length);
    await pressPad(page, 5);
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), liveCount);
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    checks.push(`${mode}: a live source without a queue successor has no next hint and an inactive shortcut cannot interrupt it`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
