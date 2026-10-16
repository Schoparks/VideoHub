import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-retained-focus');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  for (const theme of ['light', 'dark']) {
    const label = `${tv ? 'TV' : 'desktop'}-${theme}`;
    const { page, errors, close } = await launchHeadlessRenderer(tv
      ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
    const inspect = async target => {
      const state = await target.evaluate(node => {
        const numbers = color => color.match(/[\d.]+/g)?.map(Number);
        let background = [255, 255, 255];
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const color = numbers(getComputedStyle(parent).backgroundColor);
          if (color && (color.length === 3 || color[3] === 1)) { background = color; break; }
        }
        const style = getComputedStyle(node);
        const opacity = Number(style.opacity);
        const ink = numbers(style.outlineColor).slice(0, 3)
          .map((value, index) => value * opacity + background[index] * (1 - opacity));
        const luminance = color => color.slice(0, 3).map(value => {
          const component = value / 255;
          return component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const a = luminance(ink), b = luminance(background);
        return { focused: node === document.activeElement,
          contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
          outlineWidth: parseFloat(style.outlineWidth),
          disabled: node.disabled, ariaDisabled: node.getAttribute('aria-disabled') };
      });
      await writeFile(resolve(output, `${label}-state.json`), JSON.stringify(state, null, 2));
      assert.equal(state.focused, true);
      assert.equal(state.disabled, false);
      assert.equal(state.ariaDisabled, 'true');
      assert.ok(state.outlineWidth > 0);
      assert.ok(state.contrast >= 3, `${label}: retained focus contrast ${state.contrast}`);
    };
    try {
      await page.evaluate(({ tv, theme }) => {
        const state = window.reliability;
        Object.assign(state.boot.preferences, { tvMode: tv, theme });
        state.refreshCalls = 0;
        const original = window.hub.browse;
        window.hub.browse = async request => {
          state.refreshCalls++;
          if (state.holdBrowse) await new Promise(resolve => { state.finishBrowse = resolve; });
          return original(request);
        };
      }, { tv, theme });
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await page.locator('main .media-card').first().waitFor();
      await connectPad(page);
      await page.evaluate(() => { window.reliability.holdBrowse = true; });
      const refresh = page.getByRole('button', { name: '换一批', exact: true });
      await refresh.focus();
      await pressPad(page, 0);
      await page.waitForFunction(() => !!window.reliability.finishBrowse);
      await inspect(refresh);
      const calls = await page.evaluate(() => window.reliability.refreshCalls);
      await pressPad(page, 0);
      await refresh.evaluate(node => node.click());
      assert.equal(await page.evaluate(() => window.reliability.refreshCalls), calls);
      assert.equal(await page.locator('.controller-actions').innerText().then(text => text.includes('确认')), false);
      await page.keyboard.press('Shift');
      await inspect(refresh);
      await page.screenshot({ path: resolve(output, `${label}-refresh.png`) });
      await page.evaluate(() => { window.reliability.holdBrowse = false; window.reliability.finishBrowse(); });
      await page.waitForFunction(() => document.querySelector('.section-heading button')?.getAttribute('aria-disabled') === 'false');
      checks.push(`${label}: pending refresh retains high-contrast controller/keyboard focus and rejects repeated confirmation`);

      await page.locator('.card-details').first().click();
      const queued = page.getByRole('button', { name: '已在队列中', exact: true });
      await queued.waitFor();
      await queued.focus();
      await pressPad(page, 0);
      await inspect(queued);
      assert.equal(await page.evaluate(() => window.reliability.boot.queue.length), 2);
      assert.equal(await page.locator('.controller-actions').innerText().then(text => text.includes('确认')), false);
      assert.deepEqual(errors, []);
      checks.push(`${label}: unavailable queued action keeps a clear focus without enabling or duplicating the action`);
    } catch (error) {
      await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2));
      throw error;
    } finally { await close(); }
  }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
