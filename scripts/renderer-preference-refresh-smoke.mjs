import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

const output = resolve('.tmp/renderer-preference-refresh');
await mkdir(output, { recursive: true });
const checks = [];
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const tv = () => page.getByRole('switch', { name: '电视模式', exact: true });
const open = async () => {
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.paused === false);
};
const exit = async () => {
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
};

try {
  await page.evaluate(() => {
    const state = window.reliability;
    state.windowCalls = [];
    state.preferenceCalls = [];
    const preferences = window.hub.preferences;
    window.hub.preferences = async value => {
      state.preferenceCalls.push(structuredClone(value));
      if (state.failPreference) { state.failPreference = false; throw new Error('设置保存失败'); }
      return preferences(value);
    };
    window.hub.fullscreen = async value => {
      state.windowCalls.push(value);
      if (state.holdPreferenceWindow) await new Promise(resolve => { state.finishPreferenceWindow = resolve; });
    };
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await open();
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.evaluate(() => { window.reliability.holdPreferenceWindow = true; });
  await tv().click();
  await page.waitForFunction(() => !!window.reliability.finishPreferenceWindow);
  await tv().click();
  await page.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('1.5');
  assert.equal(await tv().isChecked(), false);
  const beforeRefresh = await page.evaluate(() => window.reliability.bootstrapCalls);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await exit();
  await page.waitForFunction(before => window.reliability.bootstrapCalls > before, beforeRefresh);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await tv().isChecked(), false, 'player return must not replace queued settings with stale bootstrap preferences');
  assert.equal(await page.getByRole('combobox', { name: '默认播放速度', exact: true }).inputValue(), '1.5');
  checks.push('returning from playback while fullscreen blocks queued settings retains the latest TV and rate choices');

  await page.evaluate(() => {
    window.reliability.holdPreferenceWindow = false;
    window.reliability.finishPreferenceWindow();
  });
  await page.waitForFunction(() => window.reliability.boot.preferences.playbackRate === 1.5
    && window.reliability.boot.preferences.tvMode === false);
  assert.equal(await tv().isChecked(), false);
  assert.equal(await page.getByRole('combobox', { name: '默认播放速度', exact: true }).inputValue(), '1.5');
  assert.deepEqual(await page.evaluate(() => window.reliability.windowCalls), [true, false]);
  checks.push('serialized settings finish with the same visible and committed preferences without an extra window request');

  await page.evaluate(() => { window.reliability.failPreference = true; });
  await page.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('2');
  await page.getByRole('status').filter({ hasText: '设置保存失败' }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: '默认播放速度', exact: true }).inputValue(), '1.5');
  checks.push('a later failed edit rolls back to the last committed preference and remains retryable');

  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await open();
  assert.equal(await page.getByRole('button', { name: '播放速度', exact: true }).getAttribute('data-option-value'), '1.5');
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.evaluate(() => {
    window.reliability.holdPreferenceWindow = true;
    window.reliability.finishPreferenceWindow = null;
  });
  await tv().click();
  await page.waitForFunction(() => !!window.reliability.finishPreferenceWindow);
  await tv().click();
  await page.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('2');
  await page.evaluate(() => { window.reliability.holdBootstrap = true; });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await exit();
  await page.waitForFunction(() => !!window.reliability.finishBootstrap);
  await page.evaluate(() => {
    window.reliability.holdPreferenceWindow = false;
    window.reliability.finishPreferenceWindow();
  });
  await page.waitForFunction(() => window.reliability.boot.preferences.playbackRate === 2
    && window.reliability.boot.preferences.tvMode === false);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.reliability.holdBootstrap = false;
    window.reliability.finishBootstrap();
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await tv().isChecked(), false);
  assert.equal(await page.getByRole('combobox', { name: '默认播放速度', exact: true }).inputValue(), '2');
  checks.push('a refresh started during queued edits cannot apply its stale snapshot after all writes have finished');
  await page.getByRole('combobox', { name: '卡片大小', exact: true }).selectOption('4');
  await page.waitForFunction(() => window.reliability.boot.preferences.cardColumns === 4);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await open();
  assert.equal(await page.getByRole('button', { name: '播放速度', exact: true }).getAttribute('data-option-value'), '2');
  await page.evaluate(() => { window.reliability.boot.preferences.cardColumns = 5; });
  await exit();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '卡片大小', exact: true }).inputValue(), '5');
  assert.equal(await page.getByRole('combobox', { name: '默认播放速度', exact: true }).inputValue(), '2');
  checks.push('an idle refresh still accepts committed settings and the next video uses the saved default rate');
  await page.evaluate(() => { window.reliability.failPreference = true; });
  await page.getByRole('combobox', { name: '卡片大小', exact: true }).selectOption('6');
  await page.waitForFunction(() => document.querySelector('[aria-label="卡片大小"]')?.value === '5');
  assert.equal(await page.evaluate(() => window.reliability.boot.preferences.cardColumns), 5);
  checks.push('an authoritative idle refresh becomes the rollback base for the next failed edit');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors, simulatedMedia: true }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await page.evaluate(() => window.reliability.finishPreferenceWindow?.()).catch(() => {});
  await close();
}
