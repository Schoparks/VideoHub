import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-reading-actions');
await mkdir(output, { recursive: true });
const checks = [];
for (const tvMode of [false, true]) {
  const { page, errors, close } = await launchHeadlessRenderer(tvMode
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const label = tvMode ? 'TV' : 'desktop';
  try {
    await page.evaluate(tvMode => {
      const state = window.reliability;
      state.boot.preferences.tvMode = tvMode;
      state.itemOverride = { id: 'bili:reliability', source: 'bilibili', kind: 'video', aid: 42,
        title: '完整长标题阅读和播放器动作范围 '.repeat(80) };
      state.partsOverride = [1, 2].map(cid => ({ id: `cid:${cid}`, cid,
        title: `第 ${cid} 集 ${'完整分集说明 '.repeat(120)}` }));
    }, tvMode);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await connectPad(page);
    await page.locator('video').evaluate(video => { video.currentTime = 40; });

    for (const selector of ['.player-overlay h2', '.player-overlay header p']) {
      const text = page.locator(selector);
      assert.equal(await text.evaluate(node => node.tabIndex), -1);
      const pause = page.getByRole('button', { name: '暂停', exact: true });
      await pause.focus();
      await text.evaluate(node => { node.scrollTop = (node.scrollHeight - node.clientHeight) / 2; });
      const middle = await text.evaluate(node => node.scrollTop);
      assert.ok(middle > 0);
      await pressPad(page, 6);
      await page.locator('.player[data-seeking="true"]').waitFor();
      await pressPad(page, 13);
      assert.equal(await text.evaluate(node => node.scrollTop), middle, `${label}: seek must own Down over ${selector}`);
      await page.keyboard.press('ArrowUp');
      assert.equal(await text.evaluate(node => node.scrollTop), middle, `${label}: seek must own keyboard Up over ${selector}`);
      assert.equal(await pause.evaluate(node => node === document.activeElement), true);
      assert.equal(await page.locator('video').evaluate(video => video.currentTime), 40);
      checks.push(`${label}: readonly ${selector} is excluded; jump preview retains meaningful control focus`);

      await page.screenshot({ path: resolve(output, `${tvMode ? 'television' : 'desktop'}-${selector.endsWith('h2') ? 'title' : 'info'}.png`) });
      await pressPad(page, 1);
      await page.locator('.player[data-seeking="false"]').waitFor();
      assert.equal(await text.evaluate(node => node.scrollTop), middle);
      assert.equal(await page.locator('video').evaluate(video => video.currentTime), 40);
      checks.push(`${label}: canceling preview retains position and does not move focus into ${selector}`);

      await text.evaluate(node => { node.scrollTop = (node.scrollHeight - node.clientHeight) / 2; });
      const beforeCommit = await text.evaluate(node => node.scrollTop);
      await pressPad(page, 7);
      await pressPad(page, 0);
      await page.locator('.player[data-seeking="false"]').waitFor();
      assert.equal(await page.locator('video').evaluate(video => video.currentTime), 70);
      await page.keyboard.press('ArrowUp');
      assert.equal(await text.evaluate(node => node.scrollTop), beforeCommit);
      assert.equal(await page.getByRole('slider', { name: '播放进度', exact: true }).evaluate(node => node === document.activeElement), true);
      await page.locator('video').evaluate(video => { video.currentTime = 40; });
      checks.push(`${label}: confirming preview commits once; Up enters the actionable timeline`);
    }

    await pressPad(page, 1);
    await page.locator('.player:not(.controls-visible)').waitFor();
    await pressPad(page, 12);
    await page.locator('.player.controls-visible').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '暂停');
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 40);
    assert.deepEqual(errors, []);
    checks.push(`${label}: hiding after reading then Up reveals controls without scrolling hidden text or changing playback`);
  } catch (error) {
    const state = await page.evaluate(() => ({
      seeking: document.querySelector('.player')?.dataset.seeking,
      active: document.activeElement?.tagName,
      titleScroll: document.querySelector('.player-overlay h2')?.scrollTop,
      infoScroll: document.querySelector('.player-overlay header p')?.scrollTop,
    }));
    await writeFile(resolve(output, 'failure.json'), JSON.stringify({ message: error.message, state }, null, 2));
    throw error;
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
