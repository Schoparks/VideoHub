import assert from 'node:assert/strict';
import { revealPlayerControls } from './player-test-actions.mjs';

/** Hidden native window must remain windowed even when preferences request fullscreen. */
export async function checkHiddenWindowState(page) {
  const state = () => page.evaluate(() => window.hub.getFullscreen());
  await revealPlayerControls(page);
  assert.equal(await state(), false);
  const fullscreen = page.getByRole('button', { name: '播放器全屏', exact: true });
  await fullscreen.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="播放器全屏"]')?.getAttribute('aria-busy') !== 'true');
  assert.equal(await state(), false);
  assert.equal(await fullscreen.count(), 1);
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  const tv = page.getByRole('switch', { name: '电视模式', exact: true });
  await tv.click();
  await page.waitForFunction(async () => (await window.hub.bootstrap()).preferences.tvMode);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  assert.equal(await state(), false);
  assert.equal(await fullscreen.count(), 1);
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await tv.click();
  await page.waitForFunction(async () => !(await window.hub.bootstrap()).preferences.tvMode);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  return { stateIpc: true, toggleStayedWindowed: true, tvStayedWindowed: true, settingRestored: true };
}
