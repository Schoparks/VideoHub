import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-fullscreen');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const button = state => page.getByRole('button', { name: state ? '退出播放器全屏' : '播放器全屏', exact: true });
const requests = () => page.evaluate(() => window.reliability.windowCalls);
try {
  await page.evaluate(() => {
    const state = window.reliability;
    state.windowCalls = [];
    state.windowFullscreen = false;
    const listeners = new Set();
    state.nativeFullscreen = value => {
      state.windowFullscreen = value;
      for (const listener of listeners) listener(value);
    };
    window.hub.getFullscreen = async () => {
      const value = state.windowFullscreen;
      if (state.holdWindowRead) await new Promise(resolve => { state.finishWindowRead = resolve; });
      if (state.failWindowRead) { state.failWindowRead = false; throw new Error('旧窗口查询失败'); }
      return value;
    };
    window.hub.onFullscreen = callback => { listeners.add(callback); return () => listeners.delete(callback); };
    window.hub.fullscreen = async value => {
      state.windowCalls.push(value);
      if (state.holdWindow) await new Promise(resolve => { state.finishWindow = resolve; });
      if (state.failWindow) { state.failWindow = false; throw new Error('全屏切换失败'); }
      state.nativeFullscreen(value);
    };
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.evaluate(() => { window.reliability.holdWindowRead = true; });
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByRole('switch', { name: '电视模式', exact: true }).click();
  await page.waitForFunction(() => window.reliability.windowFullscreen);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await button(true).waitFor();
  await page.evaluate(() => { window.reliability.holdWindowRead = false; window.reliability.finishWindowRead?.(); });
  await page.waitForTimeout(100);
  assert.equal(await button(true).count(), 1);
  checks.push('TV setting updates the actual fullscreen button; a late initial snapshot cannot overwrite its event');

  await page.setViewportSize({ width: 1920, height: 1080 });
  await connectPad(page);
  await page.evaluate(() => { window.reliability.holdWindow = true; });
  await button(true).focus();
  await pressPad(page, 0);
  await page.waitForFunction(() => !!window.reliability.finishWindow);
  await pressPad(page, 0);
  await button(true).evaluate(node => node.click());
  assert.deepEqual(await requests(), [true, false]);
  assert.equal(await button(true).getAttribute('aria-busy'), 'true');
  assert.equal(await button(true).evaluate(node => node === document.activeElement), true);
  await page.waitForTimeout(5200);
  assert.equal(await page.locator('.player.controls-visible').count(), 1);
  assert.equal(await button(true).evaluate(node => node === document.activeElement), true);
  await page.screenshot({ path: resolve(output, 'pending.png') });
  await page.evaluate(() => { window.reliability.holdWindow = false; window.reliability.finishWindow(); });
  await button(false).waitFor();
  assert.equal(await page.evaluate(() => window.reliability.boot.preferences.tvMode), true);
  checks.push('pending fullscreen retains focus and blocks repeated A/pointer confirmation without changing the TV preference');

  const beforeNative = await requests();
  await page.evaluate(() => window.reliability.nativeFullscreen(true));
  await button(true).waitFor();
  await page.evaluate(() => window.reliability.nativeFullscreen(false));
  await button(false).waitFor();
  assert.deepEqual(await requests(), beforeNative);
  checks.push('native window enter/leave events update controls without issuing another request');

  await page.evaluate(() => {
    window.reliability.holdWindowRead = true;
    window.reliability.failWindowRead = true;
    window.reliability.finishWindowRead = undefined;
  });
  await button(false).click();
  await page.waitForFunction(() => !!window.reliability.finishWindowRead);
  await page.evaluate(() => window.reliability.nativeFullscreen(false));
  await page.evaluate(() => { window.reliability.holdWindowRead = false; window.reliability.finishWindowRead(); });
  await page.waitForTimeout(100);
  assert.equal(await page.getByText('旧窗口查询失败', { exact: true }).count(), 0);
  assert.equal(await button(false).getAttribute('aria-busy'), null);
  checks.push('a failed stale confirmation query cannot report an error after a newer native event');

  await page.evaluate(() => { window.reliability.failWindow = true; });
  await button(false).click();
  await page.getByText('全屏切换失败', { exact: true }).waitFor();
  assert.equal(await button(false).getAttribute('aria-busy'), null);
  assert.equal(await page.evaluate(() => window.reliability.windowFullscreen), false);
  checks.push('failed fullscreen preserves the confirmed state, reports failure and permits a new operation');

  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByRole('switch', { name: '电视模式', exact: true }).click();
  await page.waitForFunction(() => !window.reliability.boot.preferences.tvMode);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await button(false).click();
  await button(true).waitFor();
  await page.evaluate(() => { window.reliability.holdWindow = true; });
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => window.reliability.windowCalls.at(-1) === false);
  const leavingCalls = await requests();
  await button(true).evaluate(node => node.click());
  await page.getByRole('button', { name: '退出播放', exact: true }).evaluate(node => node.click());
  assert.deepEqual(await requests(), leavingCalls);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await page.evaluate(() => { window.reliability.holdWindow = false; window.reliability.finishWindow(); });
  await page.waitForFunction(() => !document.querySelector('.player'));
  assert.equal(await page.evaluate(() => window.reliability.windowFullscreen), false);
  checks.push('return waits for restoration to the latest TV setting; repeated exit/fullscreen cannot enqueue a conflicting change');

  await page.evaluate(() => { window.reliability.holdWindowRead = true; window.reliability.failWindowRead = true; });
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.evaluate(() => window.reliability.nativeFullscreen(true));
  await button(true).waitFor();
  await page.evaluate(() => { window.reliability.holdWindowRead = false; window.reliability.finishWindowRead(); });
  await page.waitForTimeout(100);
  assert.equal(await page.getByText('旧窗口查询失败', { exact: true }).count(), 0);
  checks.push('a failed stale initial state query cannot report an error after a newer native event');
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  const callsAfterExit = await requests();
  await page.evaluate(() => window.reliability.nativeFullscreen(true));
  await page.waitForTimeout(100);
  assert.deepEqual(await requests(), callsAfterExit);
  assert.deepEqual(errors, []);
  checks.push('unmounted player releases its event subscription; later native events cannot reopen playback or issue requests');
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
