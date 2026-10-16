import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-browse-page-focus');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const up = tv ? 8 : 6;
  const down = tv ? 10 : 7;
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const state = () => page.evaluate(() => ({
    id: document.activeElement?.getAttribute('data-media-id'),
    scroll: document.querySelector('main').scrollTop,
    main: document.querySelector('main').getBoundingClientRect().toJSON(),
    active: document.activeElement?.getBoundingClientRect().toJSON(),
  }));
  try {
    await page.evaluate(() => {
      window.hub.browse = async () => ({ items: Array.from({ length: 240 }, (_, index) => ({
        ...window.reliability.boot.queue[0], id: `video:${index}`, title: `列表视频 ${index + 1}`,
      })), hasMore: false });
    });
    if (tv) await page.evaluate(() => {
      window.reliability.boot.preferences.gamepadMap.rewind = 8;
      window.reliability.boot.preferences.gamepadMap.forward = 10;
    });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '哔哩哔哩', exact: true }).click();
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('main .media-card').length === 240);
    if (tv) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('switch', { name: '电视模式', exact: true }).click();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    await connectPad(page);
    for (const columns of [2, 4, 6]) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('combobox', { name: '卡片大小', exact: true }).selectOption(String(columns));
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await page.locator('main .media-card').nth(180 + columns - 1).focus();
      const before = await state();
      await pressPad(page, up);
      const above = await state();
      assert.notEqual(above.id, before.id, 'LT must move from the deep list');
      assert.ok(above.scroll < before.scroll - 100);
      assert.ok(Math.abs(above.active.x - before.active.x) < 2, 'page movement preserves column');
      assert.ok(above.active.top >= above.main.top && above.active.bottom <= above.main.bottom);
      await pressPad(page, down);
      const below = await state();
      assert.ok(below.scroll > above.scroll + 100);
      assert.ok(Math.abs(below.active.x - before.active.x) < 2);
      checks.push(`${mode}/${columns}: LT/RT move focus and scroll by a screen while preserving the card column`);
    }
    const beforeKeyboard = await state();
    await page.keyboard.press('[');
    assert.ok((await state()).scroll < beforeKeyboard.scroll - 100);
    await page.keyboard.press(']');
    assert.ok((await state()).scroll > beforeKeyboard.scroll - 100);
    checks.push(`${mode}: native bracket keys share page navigation and configured pad actions are respected`);
    const beforeHold = await state();
    await pressPad(page, up, 2000);
    const held = await state();
    assert.ok(held.scroll < beforeHold.scroll - beforeHold.main.height * 2);
    checks.push(`${mode}: holding LT repeatedly moves upward instead of requiring one action per row`);
    await page.locator('main .media-card').first().focus();
    await pressPad(page, up);
    assert.equal(await page.locator('main').evaluate(node => node.scrollTop), 0);
    assert.ok(await page.evaluate(() => document.activeElement?.matches('.tabs button, .chips button, .section-heading button')));
    checks.push(`${mode}: paging above the first row reaches a useful top control`);
    const scrollBefore = await page.locator('main').evaluate(node => node.scrollTop);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await pressPad(page, down);
    assert.equal(await page.locator('main').evaluate(node => node.scrollTop), scrollBefore);
    await pressPad(page, 1);
    checks.push(`${mode}: a modal isolates page navigation from the background list`);
    await page.locator('main .media-card').first().focus();
    await page.keyboard.press(']');
    await page.screenshot({ path: resolve(output, `${mode}.png`) });
    await page.locator('main .media-card').first().click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await page.locator('video').evaluate(video => { video.currentTime = 40; });
    await pressPad(page, up);
    await page.locator('.player[data-seeking="true"]').waitFor();
    assert.equal(await page.locator('.timeline').inputValue(), '10');
    await pressPad(page, 1);
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 40);
    checks.push(`${mode}: playback keeps its 30-second preview/cancel semantics instead of paging the hidden list`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, simulatedGamepad: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
