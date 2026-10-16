import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-player-scroll-focus');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const visibleFocus = async (selector, label) => {
    const bounds = await page.locator(selector).evaluate(list => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || !list.contains(focused)) return { focused: false };
      const rect = focused.getBoundingClientRect();
      const clip = list.getBoundingClientRect();
      const style = getComputedStyle(focused);
      const ring = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { focused: true, ring,
        gaps: [rect.left - clip.left, clip.right - rect.right, rect.top - clip.top, clip.bottom - rect.bottom],
        hit: focused === hit || focused.contains(hit) };
    });
    assert.equal(bounds.focused, true, label);
    assert.ok(bounds.ring > 0, `${label}: focus must be visible`);
    assert.ok(bounds.gaps.every(gap => gap >= bounds.ring - 1), `${label}: clipped ring ${JSON.stringify(bounds)}`);
    assert.equal(bounds.hit, true, `${label}: focus target covered`);
  };
  const episode = () => page.getByRole('dialog', { name: '选择分集', exact: true });
  const openEpisodes = async () => {
    await pressPad(page, 2);
    await episode().waitFor();
  };
  try {
    await page.getByRole('button', { name: '重试', exact: true }).click();
    if (tv) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('switch', { name: '电视模式', exact: true }).click();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    await page.evaluate(() => {
      window.reliability.partsOverride = Array.from({ length: 120 }, (_, index) => ({
        id: `cid:${index + 1}`, cid: index + 1, title: `第 ${index + 1} 集 · 多分集导航检查`,
      }));
      const resolve = window.hub.resolve;
      window.hub.resolve = (...args) => resolve(args[0], args[1] || window.reliability.partsOverride[79], args[2]);
    });
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await connectPad(page);
    await openEpisodes();
    assert.equal(await page.locator('.episode-option[aria-current]').evaluate(node => node === document.activeElement), true);
    await visibleFocus('.episode-list', 'open current episode 80');
    for (const direction of [13, 13, 12, 12]) {
      await pressPad(page, direction);
      await visibleFocus('.episode-list', `episode direction ${direction}`);
    }
    checks.push(`${tv ? 'TV' : 'desktop'}: opening a deep current episode and direction scrolling preserve the entire focus ring`);
    await page.keyboard.press('ArrowDown');
    await visibleFocus('.episode-list', 'keyboard next episode');
    await page.keyboard.press('ArrowUp');
    await visibleFocus('.episode-list', 'keyboard previous episode');
    checks.push(`${tv ? 'TV' : 'desktop'}: keyboard navigation keeps its actual outline inside the same scroll boundaries`);

    for (const index of [0, 119]) {
      await page.locator('.episode-option').nth(index).focus();
      await pressPad(page, 0);
      await episode().waitFor({ state: 'detached' });
      await page.waitForFunction(index => document.querySelector('.player-overlay header p')?.textContent.includes(`第 ${index + 1} 集`)
        && document.querySelector('.player')?.dataset.switching === 'false', index);
      await openEpisodes();
      await visibleFocus('.episode-list', `endpoint ${index + 1}`);
    }
    await page.screenshot({ path: resolve(output, `${tv ? 'tv' : 'desktop'}-episodes.png`) });
    checks.push(`${tv ? 'TV' : 'desktop'}: first and last episode focus fits the clipping boundaries and remains confirmable`);
    await pressPad(page, 1);
    await episode().waitFor({ state: 'detached' });

    await page.getByRole('button', { name: '播放速度', exact: true }).focus();
    await pressPad(page, 0);
    await page.getByRole('dialog', { name: '播放速度', exact: true }).waitFor();
    await visibleFocus('.player-option-list', 'rate current');
    await pressPad(page, 13);
    await visibleFocus('.player-option-list', 'rate next');
    await page.screenshot({ path: resolve(output, `${tv ? 'tv' : 'desktop'}-rate.png`) });
    await pressPad(page, 1);
    await page.getByRole('dialog', { name: '播放速度', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: '播放速度', exact: true }).getAttribute('data-option-value'), '1');
    await page.getByRole('button', { name: '清晰度', exact: true }).focus();
    await pressPad(page, 0);
    await page.getByRole('dialog', { name: '清晰度', exact: true }).waitFor();
    await visibleFocus('.player-option-list', 'quality current');
    await pressPad(page, 13);
    await visibleFocus('.player-option-list', 'quality next');
    await pressPad(page, 1);
    await page.getByRole('dialog', { name: '清晰度', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: '清晰度', exact: true }).getAttribute('data-option-value'), '80');
    checks.push(`${tv ? 'TV' : 'desktop'}: rate/quality menus retain unclipped focus and cancel without applying a value`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, simulatedMedia: true, simulatedGamepad: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
