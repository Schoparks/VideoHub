import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-player-modal-focus');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const focused = locator => locator.evaluate(node => node === document.activeElement);
  const visibleFocus = async () => {
    const bounds = await page.locator('.modal').evaluate(modal => {
      const node = document.activeElement;
      if (!(node instanceof HTMLElement) || !modal.contains(node)) return { focused: false };
      const rect = node.getBoundingClientRect();
      const header = modal.querySelector('.modal-header').getBoundingClientRect();
      const footer = modal.querySelector('.modal-input-hints').getBoundingClientRect();
      const clip = modal.getBoundingClientRect();
      const style = getComputedStyle(node);
      const ring = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        focused: true, label: node.getAttribute('aria-label') || node.textContent, ring,
        gaps: [rect.left - clip.left, clip.right - rect.right,
          rect.top - (node.closest('.modal-header') ? clip.top : header.bottom), footer.top - rect.bottom],
        hit: hit === node || node.contains(hit),
      };
    });
    assert.equal(bounds.focused, true);
    assert.ok(bounds.ring > 0);
    assert.ok(bounds.gaps.every(gap => gap >= bounds.ring - 1), JSON.stringify({ mode, ...bounds }));
    assert.equal(bounds.hit, true);
  };
  try {
    await page.evaluate(() => {
      const state = window.reliability;
      state.boot.queue = Array.from({ length: 40 }, (_, index) => ({
        ...state.boot.queue[0], id: `queue:${index}`, title: `第 ${index + 1} 个视频`,
      }));
    });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    if (tv) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('switch', { name: '电视模式', exact: true }).click();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await connectPad(page);
    for (const name of ['播放速度', '清晰度']) {
      const button = page.getByRole('button', { name, exact: true });
      const value = await button.getAttribute('data-option-value');
      await button.focus();
      await pressPad(page, 14);
      assert.equal(await focused(button), false, `${mode}: left must leave ${name}`);
      assert.equal(await button.getAttribute('data-option-value'), value);
      assert.equal(await page.getByRole('dialog').count(), 0);
      await button.focus();
      await pressPad(page, 0);
      await page.getByRole('dialog', { name, exact: true }).waitFor();
      await pressPad(page, 13);
      await pressPad(page, 1);
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.equal(await button.getAttribute('data-option-value'), value);
      assert.equal(await focused(button), true);
    }
    checks.push(`${mode}: rate/quality directions leave buttons; A opens and B cancels to the unchanged opener`);

    for (const name of ['播放队列', '播放设置']) {
      const opener = page.getByRole('button', { name, exact: true });
      await opener.focus();
      await pressPad(page, 0);
      await page.getByRole('dialog').waitFor();
      await page.locator('.modal').locator('button,input,select').last().focus();
      for (let index = 0; index < (name === '播放队列' ? 35 : 12); index++) {
        await pressPad(page, 12);
        await visibleFocus();
      }
      checks.push(`${mode}: ${name} upward navigation keeps the full focus outline below the sticky heading`);
      if (name === '播放队列') {
        for (let index = 0; index < 20; index++) {
          await pressPad(page, 13);
          await visibleFocus();
        }
        for (let index = 0; index < 10; index++) {
          await page.keyboard.press('ArrowUp');
          await visibleFocus();
        }
        await page.screenshot({ path: resolve(output, `${mode}-queue.png`) });
        checks.push(`${mode}: long queue downward and keyboard upward navigation also retain full focus visibility`);
      }
      await pressPad(page, 1);
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.waitForFunction(name => document.activeElement?.getAttribute('aria-label') === name, name);
      assert.equal(await page.evaluate(() => document.querySelector('video').paused), false);
      await pressPad(page, 1);
      await page.waitForFunction(() => !document.querySelector('.player').classList.contains('controls-visible'));
      assert.equal(await page.locator('video').count(), 1);
      assert.equal(await page.evaluate(() => document.querySelector('video').paused), false);
      await pressPad(page, 12);
      await page.waitForFunction(() => document.querySelector('.player').classList.contains('controls-visible'));
    }
    checks.push(`${mode}: B dismisses a modal to its opener, then hides the layer without exiting or pausing`);
    await pressPad(page, 9);
    await page.waitForFunction(() => document.querySelector('video').paused);
    await pressPad(page, 1);
    await page.waitForFunction(() => !document.querySelector('.player').classList.contains('controls-visible'));
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true);
    await pressPad(page, 1);
    await page.locator('.player').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.reliability.releases.length), 1);
    checks.push(`${mode}: manual hiding preserves pause; a second B exits and releases once`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, simulatedMedia: true, simulatedGamepad: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
