import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-focus-return-intent');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const freeze = () => page.evaluate(() => {
    const state = window.returnAudit = {
      frame: requestAnimationFrame, cancel: cancelAnimationFrame, callbacks: new Map(), id: 0,
    };
    window.requestAnimationFrame = callback => {
      const id = --state.id;
      state.callbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = id => {
      if (id < 0) state.callbacks.delete(id);
      else state.cancel(id);
    };
  });
  const release = async () => {
    await page.evaluate(() => {
      const state = window.returnAudit;
      window.requestAnimationFrame = state.frame;
      for (const [id, callback] of state.callbacks) requestAnimationFrame(time => {
        if (!state.callbacks.has(id)) return;
        state.callbacks.delete(id);
        callback(time);
      });
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => { window.cancelAnimationFrame = window.returnAudit.cancel; });
  };
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  const dismiss = async () => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), undefined, { polling: 50 });
  };
  try {
    await page.getByRole('button', { name: '重试', exact: true }).click();
    if (tv) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('switch', { name: '电视模式', exact: true }).click();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await page.keyboard.press('Space');
    for (const name of ['清晰度', '播放速度', '选集，共 2 集', '播放设置', '播放队列']) {
      const opener = page.getByRole('button', { name, exact: true });
      await opener.click();
      await page.getByRole('dialog').waitFor();
      await dismiss();
      await page.waitForFunction(name => document.activeElement?.getAttribute('aria-label') === name, name);
      assert.equal(await page.locator('video').evaluate(video => video.paused), true);
      checks.push(`${mode}: normal closing of ${name} restores its opener and preserves pause`);

      await opener.click();
      await page.getByRole('dialog').waitFor();
      await freeze();
      await dismiss();
      await page.keyboard.press('Tab');
      const before = await active();
      assert.equal(before, '退出播放');
      await release();
      assert.equal(await active(), before, `${name} must not override later Tab navigation`);
      checks.push(`${mode}: delayed closing of ${name} respects later native Tab navigation`);
    }
    await page.getByRole('button', { name: '清晰度', exact: true }).click();
    await freeze();
    await dismiss();
    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await page.getByRole('switch', { name: '深色外观', exact: true }).click();
    await release();
    assert.equal(await active(), '深色外观');
    assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).count(), 1);
    checks.push(`${mode}: opening and editing another overlay cancels the older pointer return`);
    await dismiss();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放设置');

    await connectPad(page);
    await page.getByRole('button', { name: '清晰度', exact: true }).focus();
    await pressPad(page, 0);
    await page.getByRole('dialog', { name: '清晰度', exact: true }).waitFor();
    await freeze();
    await page.waitForFunction(() => window.returnAudit.callbacks.size > 0, undefined, { polling: 50 });
    await dismiss();
    await page.evaluate(() => { window.testPad.buttons[15] = { pressed: true, value: 1 }; });
    await release();
    await page.evaluate(() => { window.testPad.buttons[15] = { pressed: false, value: 0 }; });
    assert.equal(await active(), '从头播放');
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    checks.push(`${mode}: an actual simulated-pad direction supersedes delayed opener restoration`);

    await page.getByRole('button', { name: '播放速度', exact: true }).click();
    await freeze();
    await dismiss();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.player').classList.contains('controls-visible'),
      undefined, { polling: 50 });
    await release();
    assert.equal(await page.locator('.player.controls-visible').count(), 0);
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    await page.keyboard.press('Escape');
    await page.locator('.player').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.reliability.releases.length), 1);
    assert.deepEqual(errors, []);
    checks.push(`${mode}: immediate B/Escape hiding survives delayed return and the next back exits once`);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, simulatedMedia: true, delayedFrames: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
