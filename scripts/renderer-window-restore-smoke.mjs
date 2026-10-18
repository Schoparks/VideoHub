import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

const output = resolve('.tmp/renderer-window-restore');
await mkdir(output, { recursive: true });
const checks = [];
for (const tvMode of [true, false]) {
  for (const entry of [false, true]) {
    const { page, errors, close } = await launchHeadlessRenderer(
      { width: 1440, height: 950 }, installReliabilityFixture);
    const fullscreen = value => page.getByRole('button', {
      name: value ? '退出播放器全屏' : '播放器全屏', exact: true,
    });
    const open = async () => {
      await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
      await fullscreen(entry).waitFor();
      await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    };
    const leave = async () => {
      await page.getByRole('button', { name: '退出播放', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.player'));
      assert.equal(await page.evaluate(() => window.reliability.windowFullscreen), entry);
    };
    try {
      await page.evaluate(({ tvMode, entry }) => {
        const state = window.reliability;
        state.boot.preferences.tvMode = tvMode;
        state.windowFullscreen = entry;
        state.windowCalls = [];
        const listeners = new Set();
        window.hub.getFullscreen = async () => {
          const value = state.windowFullscreen;
          if (state.holdRead) await new Promise(resolve => { state.finishRead = resolve; });
          return value;
        };
        window.hub.onFullscreen = callback => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        };
        window.hub.fullscreen = async value => {
          state.windowCalls.push(value);
          if (state.holdWindow) await new Promise(resolve => { state.finishWindow = resolve; });
          state.windowFullscreen = value;
          for (const callback of listeners) callback(value);
        };
      }, { tvMode, entry });
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await open();
      await leave();
      assert.deepEqual(await page.evaluate(() => window.reliability.windowCalls), []);
      checks.push(`TV=${tvMode}, native=${entry}: leaving untouched playback never changes the window`);

      for (let round = 0; round < 2; round++) {
        await open();
        await fullscreen(entry).click();
        await fullscreen(!entry).waitFor();
        await leave();
      }
      assert.deepEqual(await page.evaluate(() => window.reliability.windowCalls),
        [!entry, entry, !entry, entry]);
      checks.push(`TV=${tvMode}, native=${entry}: repeated playback restores actual entry state, preserving the preference`);

      await open();
      await page.evaluate(() => { window.reliability.holdWindow = true; });
      await fullscreen(entry).click();
      await page.waitForFunction(() => !!window.reliability.finishWindow);
      await page.getByRole('button', { name: '退出播放', exact: true }).click();
      await page.locator('.player[data-exiting="true"]').waitFor();
      await fullscreen(entry).evaluate(node => node.click());
      await page.evaluate(() => {
        window.reliability.holdWindow = false;
        window.reliability.finishWindow();
      });
      await page.waitForFunction(() => !document.querySelector('.player'));
      assert.equal(await page.evaluate(() => window.reliability.windowFullscreen), entry);
      assert.equal(await page.evaluate(() => window.reliability.boot.preferences.tvMode), tvMode);
      checks.push(`TV=${tvMode}, native=${entry}: exit waits for entry transition and restores once without accepting another toggle`);

      await page.evaluate(() => {
        window.reliability.holdRead = true;
        window.reliability.finishRead = undefined;
        window.reliability.windowCalls = [];
      });
      await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
      await page.waitForFunction(() => !!window.reliability.finishRead);
      const initializing = page.locator('.player-buttons button[aria-busy="true"]');
      await initializing.evaluate(node => { node.click(); node.click(); });
      assert.deepEqual(await page.evaluate(() => window.reliability.windowCalls), []);
      await page.evaluate(() => {
        window.reliability.holdRead = false;
        window.reliability.finishRead();
      });
      await fullscreen(!entry).waitFor();
      await leave();
      assert.deepEqual(await page.evaluate(() => window.reliability.windowCalls), [!entry, entry]);
      checks.push(`TV=${tvMode}, native=${entry}: early repeated confirmation waits for actual entry snapshot and toggles once`);
      assert.deepEqual(errors, []);
    } finally { await close(); }
  }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
