import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-player-menu-hit');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const verify = async (name, target, list, context = '') => {
    const dialog = page.getByRole('dialog', { name, exact: true });
    await pressPad(page, 14);
    await target.focus();
    const geometry = async () => ({
      dialog: await dialog.boundingBox(), list: await list.boundingBox(), control: await target.boundingBox(),
    });
    const before = await geometry();
    const snapshotName = `${mode}-${name}${context ? `-${context}` : ''}`;
    await page.screenshot({ path: resolve(output, `${snapshotName}.png`) });
    const point = { x: before.control.x + before.control.width / 2, y: before.control.y + before.control.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.waitForFunction(() => document.documentElement.dataset.inputMode === 'pointer');
    const pointer = await geometry();
    await page.keyboard.press('Shift');
    await page.waitForFunction(() => document.documentElement.dataset.inputMode === 'keyboard');
    const keyboard = await geometry();
    await writeFile(resolve(output, `${snapshotName}-geometry.json`), JSON.stringify({ before, pointer, keyboard }, null, 2));
    for (const snapshot of [pointer, keyboard]) {
      for (const object of ['dialog', 'list', 'control']) {
        for (const dimension of ['x', 'y', 'width', 'height']) {
          assert.ok(Math.abs(before[object][dimension] - snapshot[object][dimension]) < .5,
            `${mode} ${name}: ${object} ${dimension} moved`);
        }
      }
    }
    await page.mouse.move(point.x + 1, point.y);
    await page.waitForFunction(() => document.documentElement.dataset.inputMode === 'pointer');
    assert.equal(await dialog.locator('.controller-focus-hint').isVisible(), false);
    await page.mouse.click(point.x, point.y);
    await dialog.waitFor({ state: 'detached' });
    checks.push(`${mode}: ${name}${context ? ` (${context})` : ''} menu/list/control geometry stays stable across gamepad, pointer and keyboard; saved-coordinate click lands`);
  };
  try {
    await page.evaluate(tv => { window.reliability.boot.preferences.tvMode = tv; }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await connectPad(page);
    const initial = await page.evaluate(() => window.reliability.resolves.length);
    const rate = page.getByRole('button', { name: '播放速度', exact: true });
    await rate.focus();
    await pressPad(page, 0);
    await verify('播放速度', page.getByRole('dialog', { name: '播放速度', exact: true })
      .getByRole('button', { name: '1.5×', exact: true }), page.locator('.player-option-list'));
    assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1.5);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放速度');
    const quality = page.getByRole('button', { name: '清晰度', exact: true });
    await quality.focus();
    await pressPad(page, 0);
    await verify('清晰度', page.getByRole('button', { name: '关闭清晰度', exact: true }), page.locator('.player-option-list'));
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '清晰度');
    const episodes = page.getByRole('button', { name: /^选集，共/ });
    await episodes.focus();
    await pressPad(page, 0);
    await verify('选择分集', page.getByRole('button', { name: '关闭选集', exact: true }), page.locator('.episode-list'));
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('选集，共'));
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), initial);
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);

    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    await page.evaluate(() => {
      const state = window.reliability;
      state.partsOverride = Array.from({ length: 120 }, (_, index) => ({
        id: `cid:${index + 1}`, cid: index + 1, title: `第 ${index + 1} 集 · 深列表命中检查`,
      }));
      const original = window.hub.resolve;
      window.hub.resolve = (item, part, quality) => original(item, part || state.partsOverride[79], quality);
    });
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await page.getByRole('button', { name: /^选集，共/ }).focus();
    await pressPad(page, 0);
    const deepRequests = await page.evaluate(() => window.reliability.resolves.length);
    await verify('选择分集', page.locator('.episode-option').nth(80), page.locator('.episode-list'), '120集深列表');
    await page.waitForFunction(() => window.reliability.resolves.at(-1)?.part === 'cid:81'
      && document.querySelector('.player')?.dataset.switching === 'false');
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), deepRequests + 1);
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    assert.deepEqual(errors, []);
  } catch (error) {
    await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2));
    throw error;
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
