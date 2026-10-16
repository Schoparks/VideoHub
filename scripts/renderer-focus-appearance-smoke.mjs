import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-focus-appearance');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  for (const theme of ['light', 'dark']) {
    const label = `${tv ? 'TV' : 'desktop'}-${theme}`;
    const { page, errors, close } = await launchHeadlessRenderer(tv
      ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
    const verify = async (target, name, marker = target) => {
      await target.focus();
      const state = await marker.evaluate(node => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const inset = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        const rgb = color => color.match(/[\d.]+/g)?.map(Number);
        let background;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const color = rgb(getComputedStyle(parent).backgroundColor);
          if (color && (color.length === 3 || color[3] === 1)) { background = color; break; }
        }
        const luminance = color => color.slice(0, 3).map(value => {
          const component = value / 255;
          return component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const foreground = luminance(rgb(style.outlineColor));
        const backdrop = luminance(background || [0, 0, 0]);
        return {
          focused: node === document.activeElement || node.contains(document.activeElement),
          inset, width: parseFloat(style.outlineWidth), shadow: style.boxShadow,
          contrast: (Math.max(foreground, backdrop) + .05) / (Math.min(foreground, backdrop) + .05),
          viewport: rect.left - inset >= 0 && rect.top - inset >= 0
            && rect.right + inset <= innerWidth && rect.bottom + inset <= innerHeight,
          hit: hit === node || node.contains(hit),
        };
      });
      assert.equal(state.focused, true, `${label}/${name}: focus belongs to the visible control`);
      assert.ok(state.width > 0 && state.width <= 2.5 && state.inset <= 6,
        `${label}/${name}: focus should use a compact single stroke`);
      assert.equal(state.shadow, 'none', `${label}/${name}: no second halo`);
      assert.ok(state.contrast >= 3, `${label}/${name}: insufficient contrast ${state.contrast}`);
      assert.equal(state.viewport && state.hit, true, `${label}/${name}: focus outside viewport or covered`);
      await page.screenshot({ path: resolve(output, `${label}-${name}.png`) });
      checks.push(`${label}/${name}: compact high-contrast focus remains visible and hit-testable`);
    };
    try {
      await page.evaluate(({ tv, theme }) => {
        Object.assign(window.reliability.boot.preferences, { tvMode: tv, theme });
      }, { tv, theme });
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await connectPad(page);
      const nav = page.getByRole('button', { name: '首页', exact: true });
      await verify(nav, 'navigation');
      await pressPad(page, 15);
      assert.equal(await page.getByRole('button', { name: '哔哩哔哩', exact: true })
        .evaluate(node => node === document.activeElement), true);
      const card = page.getByRole('button', { name: '播放 可靠性测试', exact: true }).first();
      await verify(card, 'card');
      await verify(page.getByRole('textbox', { name: '搜索视频', exact: true }), 'search', page.locator('.global-search'));
      assert.equal(await page.getByRole('textbox', { name: '搜索视频', exact: true })
        .evaluate(node => getComputedStyle(node).outlineStyle), 'none');
      const settings = page.getByRole('button', { name: '设置', exact: true });
      await settings.focus();
      await pressPad(page, 0);
      await verify(page.getByRole('switch', { name: '电视模式', exact: true }), 'settings');
      await pressPad(page, 1);
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.equal(await settings.evaluate(node => node === document.activeElement), true);
      await card.focus();
      await pressPad(page, 0);
      await page.waitForFunction(() => document.querySelector('video')?.paused === false);
      const speed = page.getByRole('button', { name: '播放速度', exact: true });
      await verify(speed, 'player-control');
      await pressPad(page, 0);
      const dialog = page.getByRole('dialog', { name: '播放速度', exact: true });
      await dialog.waitFor();
      await verify(dialog.getByRole('button', { name: '1.5×', exact: true }), 'player-menu');
      await pressPad(page, 1);
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await speed.evaluate(node => node === document.activeElement), true);
      assert.equal(await page.locator('video').evaluate(node => node.playbackRate), 1);
      assert.deepEqual(errors, []);
    } catch (error) {
      await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2));
      throw error;
    } finally { await close(); }
  }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [], simulatedMedia: true, simulatedGamepad: true }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
