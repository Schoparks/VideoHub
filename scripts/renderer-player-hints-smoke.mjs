import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-player-hints');
await mkdir(output, { recursive: true });
const checks = [];
for (const tvMode of [false, true]) {
  const { page, errors, close } = await launchHeadlessRenderer(tvMode
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const label = tvMode ? 'TV / remapped' : 'desktop';
  const previousButton = tvMode ? 5 : 4, nextButton = tvMode ? 4 : 5;
  const previousKey = tvMode ? 'RB' : 'LB', nextKey = tvMode ? 'LB' : 'RB';
  const entries = () => page.locator('.player-hints .controller-actions > span').evaluateAll(nodes => nodes.map(node => {
    const key = node.querySelector('kbd')?.textContent;
    return { key, action: node.textContent.slice(key.length).trim() };
  }));
  const expectHints = async (previous, next, keyboard = false) => {
    const keys = keyboard ? ['PgUp', 'PgDn'] : [previousKey, nextKey];
    await page.waitForFunction(({ keys, previous, next }) => {
      const nodes = Array.from(document.querySelectorAll('.player-hints .controller-actions > span'));
      return [previous, next].every((label, index) => nodes.some(node =>
        node.querySelector('kbd')?.textContent === keys[index] && node.textContent.trim() === `${keys[index]} ${label}`));
    }, { keys, previous, next }, { timeout: 2000 });
    const values = await entries();
    assert.equal(values.some(entry => entry.action.includes('当前焦点') || entry.action === '切换分集'), false);
  };
  const open = async () => {
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    if (await page.evaluate(() => !!window.testPad)) await pressPad(page, 12);
    else await connectPad(page);
  };
  try {
    await page.evaluate(tvMode => {
      const state = window.reliability;
      state.boot.preferences.tvMode = tvMode;
      if (tvMode) Object.assign(state.boot.preferences.gamepadMap, { previous: 5, next: 4 });
      const resolve = window.hub.resolve;
      window.hub.resolve = async (...args) => {
        const result = await resolve(...args);
        return state.live ? { ...result, live: true, parts: undefined, part: undefined } : result;
      };
    }, tvMode);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await open();
    const firstEntries = await entries();
    await writeFile(resolve(output, `${tvMode ? 'TV' : 'desktop'}-first.json`), JSON.stringify(firstEntries, null, 2));
    await expectHints('从头播放', '下一集');
    checks.push(`${label}: first-part shortcuts individually identify restart and next episode with the actual mapping`);

    await pressPad(page, nextButton);
    await page.waitForFunction(() => window.reliability.resolves.at(-1).part === 'cid:2'
      && document.querySelector('.player')?.dataset.switching === 'false');
    await expectHints('上一集', '播放队列下一项');
    checks.push(`${label}: last-part shortcuts reflect previous episode and next queue item rather than a generic episode switch`);

    await pressPad(page, previousButton);
    await expectHints('从头播放', '下一集');
    assert.deepEqual(await page.evaluate(() => window.reliability.resolves.map(entry => entry.part)), ['cid:1', 'cid:2', 'cid:1']);
    checks.push(`${label}: returning to the first part updates labels without changing source order`);

    await page.evaluate(() => { window.reliability.holdResolve = true; });
    await pressPad(page, nextButton);
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    const busy = await entries();
    assert.equal(busy.some(entry => entry.key?.includes(previousKey) || entry.key?.includes(nextKey)), false);
    await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
    await expectHints('上一集', '播放队列下一项');
    checks.push(`${label}: switching suppresses disabled shortcut guidance and restores accurate actions afterward`);

    const bounds = await page.locator('.player-hints .controller-actions > span').evaluateAll(nodes =>
      nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }));
    const viewport = page.viewportSize();
    assert.ok(bounds.every(rect => rect.left >= 0 && rect.right <= viewport.width
      && rect.top >= 0 && rect.bottom <= viewport.height));
    await page.screenshot({ path: resolve(output, tvMode ? 'television-gamepad.png' : 'desktop-gamepad.png') });

    await page.keyboard.press('ArrowUp');
    await expectHints('上一集', '播放队列下一项', true);
    await page.screenshot({ path: resolve(output, tvMode ? 'television.png' : 'desktop.png') });
    checks.push(`${label}: keyboard hints use PageUp/PageDown with the same current action labels`);

    await page.getByRole('button', { name: '播放速度', exact: true }).click();
    const requests = await page.evaluate(() => window.reliability.resolves.length);
    await pressPad(page, previousButton);
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), requests);
    assert.equal(await page.locator('.player-option-panel .controller-actions > span').evaluateAll(nodes =>
      nodes.some(node => ['LB', 'RB'].includes(node.querySelector('kbd')?.textContent))), false);
    await pressPad(page, 1);
    await expectHints('上一集', '播放队列下一项');
    checks.push(`${label}: parameter menus show their own guidance and isolate background shortcuts`);

    await pressPad(page, 1);
    await page.locator('.player:not(.controls-visible)').waitFor();
    await page.locator('.controller-focus-hint').waitFor({ state: 'hidden' });
    await pressPad(page, 1);
    await page.waitForFunction(() => !document.querySelector('.player'));
    await page.evaluate(() => { window.reliability.live = true; });
    await open();
    await page.waitForFunction(({ nextKey }) => Array.from(document.querySelectorAll('.player-hints .controller-actions > span'))
      .some(node => node.querySelector('kbd')?.textContent === nextKey && node.textContent.includes('播放队列下一项')), { nextKey });
    assert.equal((await entries()).some(entry => entry.key === previousKey || /从头播放|上一集/.test(entry.action)), false);
    assert.equal(await page.locator('.controller-focus-hint').innerText().then(text => /跳转 30 秒/.test(text)), false);
    assert.deepEqual(errors, []);
    checks.push(`${label}: hidden controls have no guidance; live sources omit nonexistent previous/replay and seek actions`);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
