import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-playback-return-intent');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const freeze = () => page.evaluate(() => {
    const audit = window.playbackReturnAudit = {
      frame: requestAnimationFrame, cancel: cancelAnimationFrame, callbacks: new Map(), id: 0,
    };
    window.requestAnimationFrame = callback => {
      const id = --audit.id;
      audit.callbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = id => id < 0 ? audit.callbacks.delete(id) : audit.cancel(id);
  });
  const release = async () => {
    await page.evaluate(() => {
      const audit = window.playbackReturnAudit;
      window.requestAnimationFrame = audit.frame;
      for (const [id, callback] of audit.callbacks) requestAnimationFrame(time => {
        if (!audit.callbacks.has(id)) return;
        audit.callbacks.delete(id);
        callback(time);
      });
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => { window.cancelAnimationFrame = window.playbackReturnAudit.cancel; });
  };
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  try {
    await page.evaluate(() => {
      window.hub.browse = async () => ({ items: window.reliability.boot.queue, hasMore: false });
    });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    if (tv) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('switch', { name: '电视模式', exact: true }).click();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    const first = page.getByRole('button', { name: '播放 可靠性测试', exact: true });
    const second = page.getByRole('button', { name: '播放 另一项', exact: true });
    const pending = async () => {
      await page.evaluate(() => { window.reliability.holdResolve = true; });
      await first.click();
      await page.getByRole('button', { name: '取消准备播放', exact: true }).waitFor();
    };
    const finishLate = async () => {
      const id = await page.evaluate(() => window.reliability.resolves.at(-1).sessionId);
      await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
      await page.waitForFunction(id => window.reliability.releases.includes(id), id);
      assert.equal(await page.locator('.player').count(), 0);
    };
    await pending();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放 可靠性测试');
    await finishLate();
    checks.push(`${mode}: normal cancel restores the original card and releases the late source`);
    await pending();
    await freeze();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.working-pill'), undefined, { polling: 50 });
    await first.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await active(), '播放 另一项');
    await release();
    assert.equal(await active(), '播放 另一项', 'a delayed cancel must respect later navigation');
    await finishLate();
    checks.push(`${mode}: canceled preparation never pulls later directional focus back to the old card`);
    await connectPad(page);
    await pending();
    await freeze();
    await page.keyboard.press('Escape');
    await first.focus();
    await page.evaluate(() => { window.testPad.buttons[15] = { pressed: true, value: 1 }; });
    await release();
    await page.evaluate(() => { window.testPad.buttons[15] = { pressed: false, value: 0 }; });
    assert.equal(await active(), '播放 另一项');
    await finishLate();
    checks.push(`${mode}: simulated controller movement also cancels the older return intention`);
    await pending();
    await freeze();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('switch', { name: '深色外观', exact: true }).click();
    await release();
    assert.equal(await active(), '深色外观');
    await finishLate();
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    checks.push(`${mode}: a newly edited overlay survives late cancellation and source disposal`);
    await first.click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await freeze();
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'), undefined, { polling: 50 });
    await first.focus();
    await page.keyboard.press('ArrowRight');
    const before = await active();
    assert.notEqual(before, '播放 可靠性测试');
    await release();
    assert.equal(await active(), before);
    checks.push(`${mode}: completed exit respects new browse navigation before its delayed return`);
    await page.screenshot({ path: resolve(output, `${mode}.png`) });
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, simulatedMedia: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
