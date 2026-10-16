import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-favorite-return');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const freeze = async () => {
    await page.evaluate(() => {
      const state = window.returnAudit = {
        raf: requestAnimationFrame, cancel: cancelAnimationFrame, callbacks: new Map(), id: 0,
      };
      window.requestAnimationFrame = callback => {
        const id = --state.id;
        state.callbacks.set(id, callback);
        return id;
      };
      window.cancelAnimationFrame = id => id < 0 ? state.callbacks.delete(id) : state.cancel(id);
    });
    await page.waitForFunction(() => window.returnAudit.callbacks.size > 0, undefined, { polling: 50 });
  };
  const release = async () => {
    await page.evaluate(() => {
      const state = window.returnAudit;
      window.requestAnimationFrame = state.raf;
      for (const [id, callback] of state.callbacks) requestAnimationFrame(time => {
        if (state.callbacks.has(id)) { state.callbacks.delete(id); callback(time); }
      });
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.cancelAnimationFrame = window.returnAudit.cancel; });
  };
  const active = () => page.evaluate(() => document.activeElement?.textContent?.trim());
  const panel = page.locator('.favorite-panel');
  const favorite = page.getByRole('button', { name: '收藏', exact: true });
  const play = page.getByRole('button', { name: '立即播放', exact: true });
  const queue = page.getByRole('button', { name: '已在队列中', exact: true });
  try {
    await page.evaluate(tv => {
      window.reliability.boot.preferences.tvMode = tv;
      window.reliability.foldersMode = 'normal';
    }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('.card-details').first().click();
    await play.waitFor();
    await connectPad(page);
    for (const action of ['plain', 'keyboard', 'pointer', 'gamepad', 'parent-close', 'reopen']) {
      await favorite.click();
      await panel.waitFor();
      await freeze();
      await page.getByRole('button', { name: '收起收藏夹', exact: true }).click();
      await panel.waitFor({ state: 'detached' });
      let expected = '收藏';
      if (action === 'keyboard') {
        await play.focus();
        await page.keyboard.press('Tab');
        expected = await active();
      } else if (action === 'pointer') {
        await queue.click({ force: true });
        expected = await active();
      } else if (action === 'gamepad') {
        await play.focus();
        await page.evaluate(() => { window.testPad.buttons[15] = { pressed: true, value: 1 }; });
        expected = '已在队列中';
      } else if (action === 'parent-close') {
        await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      } else if (action === 'reopen') {
        await favorite.click();
        await panel.waitFor();
      }
      await release();
      await page.evaluate(() => { window.testPad.buttons[15] = { pressed: false, value: 0 }; });
      if (action === 'parent-close') {
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(await page.locator('main .media-card-wrap').first()
          .evaluate(node => node.contains(document.activeElement)), true);
        await pressPad(page, 2);
        await play.waitFor();
      } else if (action === 'reopen') {
        assert.equal(await page.getByRole('combobox', { name: 'B 站收藏夹', exact: true })
          .evaluate(node => node === document.activeElement), true);
        await page.getByRole('button', { name: '收起收藏夹', exact: true }).click();
        await panel.waitFor({ state: 'detached' });
      } else assert.equal(await active(), expected, `${mode}/${action}: stale favorite restoration overrode newer input`);
      checks.push(`${mode}/${action}: nested panel return respects newer input and the original active scope`);
    }
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), 0);
    assert.deepEqual(errors, []);
  } catch (error) {
    await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2));
    throw error;
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [], delayedFrames: true, simulatedGamepad: true }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
