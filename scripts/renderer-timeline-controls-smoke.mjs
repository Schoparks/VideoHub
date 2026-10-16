import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-timeline-controls');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const slider = page.getByRole('slider', { name: '播放进度', exact: true });
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  const position = () => page.locator('video').evaluate(video => video.currentTime);
  const hide = async () => {
    await page.keyboard.press('Escape');
    await page.locator('.player:not(.controls-visible)').waitFor();
  };
  const preview = async () => {
    await slider.focus();
    await pressPad(page, 15);
    await page.locator('.player[data-seeking="true"]').waitFor();
  };
  try {
    await page.evaluate(tv => { window.reliability.boot.preferences.tvMode = tv; }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await connectPad(page);
    await page.getByRole('button', { name: '暂停', exact: true }).evaluate(button => button.click());
    await page.waitForFunction(() => document.querySelector('video')?.paused);
    await page.locator('video').evaluate(video => { video.currentTime = 40; });

    if (!process.argv[2] || process.argv[2] === 'reveal') {
      await hide();
      await pressPad(page, 15);
      await page.locator('.player[data-seeking="true"]').waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放进度');
      const observation = { active: await active(), position: await position() };
      await writeFile(resolve(output, `${mode}-reveal.json`), JSON.stringify(observation));
      assert.equal(observation.active, '播放进度');
      assert.equal(observation.position, 40);
      await pressPad(page, 1);
      assert.equal(await active(), '播放进度');
      assert.equal(await position(), 40);
      checks.push(`${mode}: hidden directional preview reveals and focuses the timeline; B cancels without seeking`);
      await hide();
      await pressPad(page, 13);
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放进度');
      assert.equal(await position(), 40);
      checks.push(`${mode}: Down reveals the timeline without seeking or resuming`);
    }

    if (!process.argv[2] || process.argv[2] === 'tab') {
      await preview();
      await page.keyboard.press('Tab');
      const observation = { active: await active(), seeking: await page.locator('.player').getAttribute('data-seeking') };
      await writeFile(resolve(output, `${mode}-tab.json`), JSON.stringify(observation));
      assert.equal(observation.seeking, 'false');
      assert.equal(observation.active, '继续播放');
      assert.equal(await position(), 40);
      await pressPad(page, 0);
      assert.equal(await position(), 40);
      assert.equal(await page.locator('video').evaluate(video => video.paused), false);
      await pressPad(page, 9);
      checks.push(`${mode}: Tab leaving the preview cancels it; A operates the new focused control`);
    }

    if (!process.argv[2] || process.argv[2] === 'pointer') {
      await preview();
      const bounds = await slider.boundingBox();
      await page.mouse.move(bounds.x + bounds.width * .25, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.locator('.player[data-seeking="true"]').waitFor();
      await slider.dispatchEvent('pointercancel', { pointerId: 1 });
      await page.locator('.player[data-seeking="false"]').waitFor();
      await page.mouse.move(bounds.x + bounds.width * .75, bounds.y + bounds.height / 2);
      await page.mouse.up();
      const seeking = await page.locator('.player').getAttribute('data-seeking');
      await writeFile(resolve(output, `${mode}-pointer.json`), JSON.stringify({ seeking }));
      assert.equal(seeking, 'false');
      assert.equal(await position(), 40);
      checks.push(`${mode}: owned pointer cancellation discards the entire drag; continued movement and release cannot seek`);
    }

    if (!process.argv[2]) {
      await preview();
      await pressPad(page, 15);
      assert.equal(await slider.inputValue(), '60');
      assert.equal(await position(), 40);
      await pressPad(page, 0);
      assert.equal(await position(), 60);
      assert.equal(await active(), '播放进度');
      await pressPad(page, 13);
      assert.notEqual(await active(), '播放进度');
      checks.push(`${mode}: repeated previews remain provisional; A commits once and Down can leave afterward`);
      await hide();
      await pressPad(page, 12);
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '继续播放');
      assert.equal(await position(), 60);
      checks.push(`${mode}: Up reveals playback controls; B hide and reveal preserve pause and progress`);
      await slider.focus();
      await pressPad(page, 14);
      await page.screenshot({ path: resolve(output, `${mode}.png`) });
      await pressPad(page, 1);

      await slider.focus();
      await page.keyboard.press('End');
      assert.equal(await slider.inputValue(), '120');
      assert.equal(await position(), 60);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Home');
      assert.equal(await slider.inputValue(), '0');
      assert.equal(await position(), 60);
      await page.keyboard.press('Escape');
      checks.push(`${mode}: native Home/End previews respect the bounds and Escape keeps actual progress`);

      await page.mouse.move(700, 400);
      await page.waitForFunction(() => document.documentElement.dataset.inputMode === 'pointer');
      const bounds = await slider.boundingBox();
      const y = bounds.y + bounds.height / 2;
      await page.mouse.move(bounds.x + bounds.width * .75, y);
      await page.mouse.down();
      await page.locator('.player[data-seeking="true"]').waitFor();
      assert.equal(await position(), 60);
      await page.mouse.move(bounds.x + bounds.width * .5, y - 100);
      await page.mouse.up();
      await page.locator('.player[data-seeking="false"]').waitFor();
      assert.ok(Math.abs(await position() - 60) < 2);
      const dragged = await position();
      checks.push(`${mode}: native dragging beyond the timeline releases to commit the final preview`);

      await page.mouse.move(bounds.x + bounds.width * .8, y);
      await page.mouse.down();
      await page.locator('.player[data-seeking="true"]').waitFor();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal(await position(), dragged);
      assert.equal(await page.locator('.player').getAttribute('data-seeking'), 'false');
      checks.push(`${mode}: canceling a drag prevents its later pointer release from committing`);

      await page.getByRole('button', { name: '继续播放', exact: true }).focus();
      await pressPad(page, 9);
      await page.locator('.player:not(.controls-visible)').waitFor({ timeout: 7000 });
      await pressPad(page, 13);
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放进度');
      assert.equal(await position(), dragged);
      assert.equal(await page.locator('video').evaluate(video => video.paused), false);
      checks.push(`${mode}: timeout hiding and explicit B hiding share the same usable Down reveal without toggling playback`);

      await page.locator('video').evaluate(video => {
        Object.defineProperty(video, 'duration', { configurable: true, get: () => 0 });
        video.dispatchEvent(new Event('durationchange'));
      });
      await hide();
      await pressPad(page, 13);
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '暂停');
      assert.equal(await slider.isDisabled(), true);
      checks.push(`${mode}: an unready timeline is skipped when Down reveals playback controls`);

      await pressPad(page, 1);
      await pressPad(page, 1);
      await page.waitForFunction(() => !document.querySelector('.player'));
      await page.evaluate(() => {
        const original = window.hub.resolve;
        window.hub.resolve = async (...args) => ({ ...await original(...args), live: true });
      });
      await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
      await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
      await hide();
      await pressPad(page, 13);
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '暂停');
      assert.equal(await slider.count(), 0);
      await pressPad(page, 15);
      assert.equal(await page.locator('.player').getAttribute('data-seeking'), 'false');
      checks.push(`${mode}: live sources reveal playback controls without inventing a timeline or seek`);
    }
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
