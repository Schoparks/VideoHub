import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-overlay-focus');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const freeze = () => page.evaluate(() => {
    const audit = window.overlayAudit = {
      frame: requestAnimationFrame, cancel: cancelAnimationFrame, callbacks: new Map(), id: 0,
    };
    window.requestAnimationFrame = callback => {
      const id = --audit.id;
      audit.callbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = id => {
      if (id < 0) audit.callbacks.delete(id);
      else audit.cancel(id);
    };
  });
  const release = async () => {
    await page.evaluate(() => {
      const audit = window.overlayAudit;
      window.requestAnimationFrame = audit.frame;
      for (const [id, callback] of audit.callbacks) requestAnimationFrame(time => {
        if (!audit.callbacks.has(id)) return;
        audit.callbacks.delete(id);
        callback(time);
      });
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => { window.cancelAnimationFrame = window.overlayAudit.cancel; });
  };
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  const hide = async () => {
    await page.locator('.player [data-focus-default]').focus();
    await page.keyboard.press('Escape');
    await page.locator('.player:not(.controls-visible)').waitFor();
  };
  const unchanged = async () => {
    assert.deepEqual(await page.locator('video').evaluate(video => ({ paused: video.paused, position: video.currentTime })),
      { paused: true, position: 40 });
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), 1);
  };
  try {
    await page.evaluate(tv => {
      window.reliability.boot.preferences.tvMode = tv;
      window.reliability.omitParts = true;
    }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await page.keyboard.press('Space');
    await page.locator('video').evaluate(video => { video.currentTime = 40; });
    await connectPad(page);
    await hide();
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '继续播放');
    await unchanged();
    checks.push(`${mode}: normal Up reveal focuses the continue control without resuming or changing playback`);

    await hide();
    await freeze();
    await page.keyboard.press('ArrowUp');
    await page.locator('.player.controls-visible').waitFor();
    await page.keyboard.press('Tab');
    const before = await active();
    assert.ok(['退出播放', '从头播放'].includes(before));
    await release();
    const after = await active();
    await writeFile(resolve(output, `${mode}-tab.json`), JSON.stringify({ before, after }, null, 2));
    assert.equal(after, before, 'revealing the player must not override later Tab navigation');
    await unchanged();
    checks.push(`${mode}: a delayed Up reveal respects newer native Tab navigation`);

    await hide();
    await freeze();
    await page.keyboard.press('ArrowUp');
    await page.locator('.player.controls-visible').waitFor();
    await page.evaluate(() => { window.testPad.buttons[15] = { pressed: true, value: 1 }; });
    await release();
    await page.evaluate(() => { window.testPad.buttons[15] = { pressed: false, value: 0 }; });
    assert.equal(await active(), '从头播放');
    await unchanged();
    await page.screenshot({ path: resolve(output, `${mode}.png`) });
    checks.push(`${mode}: a later actual simulated-pad direction keeps the new control focused after reveal`);

    await hide();
    await page.keyboard.press('x');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '清晰度');
    await unchanged();
    checks.push(`${mode}: normal single-part X reveal prioritizes quality and preserves the playback state`);

    await hide();
    await freeze();
    await page.keyboard.press('x');
    await page.locator('.player.controls-visible').waitFor();
    await page.keyboard.press('Tab');
    const shortcutTab = await active();
    assert.ok(['退出播放', '从头播放'].includes(shortcutTab));
    await release();
    assert.equal(await active(), shortcutTab, 'the X focus shortcut must respect subsequent Tab navigation');
    await unchanged();
    checks.push(`${mode}: a delayed X reveal respects subsequent navigation without parsing or changing parameters`);

    await hide();
    await freeze();
    await page.keyboard.press('ArrowUp');
    await page.locator('.player.controls-visible').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.player:not(.controls-visible)').waitFor();
    await release();
    assert.equal(await page.locator('.player.controls-visible').count(), 0);
    await unchanged();
    await page.keyboard.press('Escape');
    await page.locator('.player').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.reliability.releases.length), 1);
    checks.push(`${mode}: rapid B hiding survives the delayed reveal and the next B releases playback once`);

    await page.evaluate(() => {
      const original = window.hub.resolve;
      window.hub.resolve = async (...args) => ({ ...await original(...args), qualities: undefined });
    });
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await hide();
    await page.keyboard.press('x');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放速度');
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    checks.push(`${mode}: a source without quality choices keeps the existing X fallback to playback speed`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, delayedFrames: true, simulatedMedia: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
