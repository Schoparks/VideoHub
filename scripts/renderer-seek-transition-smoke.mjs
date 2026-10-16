import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';
import { choosePlayerQuality } from './player-test-actions.mjs';

const output = resolve('.tmp/renderer-seek-transition');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const timeline = page.getByRole('slider', { name: '播放进度', exact: true });
const position = () => page.locator('video').evaluate(video => video.currentTime);
const requestCount = () => page.evaluate(() => window.reliability.resolves.length);
const finish = () => page.evaluate(() => {
  window.reliability.holdResolve = false;
  window.reliability.finishResolve();
});
const change = async value => {
  await timeline.evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, value);
};

try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.locator('video').evaluate(video => { video.currentTime = 35.25; });
  await page.evaluate(() => { window.reliability.holdResolve = true; });
  await choosePlayerQuality(page, 64);
  await page.waitForFunction(() => !!window.reliability.finishResolve);
  await timeline.focus();
  const displayedPosition = await timeline.inputValue();
  await change(90);
  const bounds = await timeline.boundingBox();
  await page.mouse.click(bounds.x + bounds.width * .8, bounds.y + bounds.height / 2);
  assert.equal(await position(), 35.25, 'pointer input must not seek a source while its replacement is pending');
  assert.equal(await timeline.getAttribute('aria-disabled'), 'true');
  assert.equal(await timeline.evaluate(node => node === document.activeElement), true);
  assert.equal(await page.locator('.seek-preview').count(), 0);
  checks.push('pointer edits and pointer-up cannot seek old media during a source change; its timeline retains focus');

  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(await position(), 35.25);
  assert.equal(await page.locator('.seek-preview').count(), 0);
  assert.equal(await timeline.inputValue(), displayedPosition);
  await connectPad(page);
  const count = await requestCount();
  for (const index of [14, 15, 0, 6, 7]) await pressPad(page, index);
  assert.equal(await position(), 35.25);
  assert.equal(await requestCount(), count);
  await page.waitForFunction(() => document.querySelector('.controller-actions')?.textContent.includes('移动'));
  assert.equal((await page.locator('.controller-actions').innerText()).includes('调整'), false);
  await pressPad(page, 13);
  assert.equal(await timeline.evaluate(node => node === document.activeElement), false);
  checks.push('native Home/End, keyboard and controller inputs cannot mutate a pending seek; hints omit adjustment and Up/Down still navigate');

  await finish();
  await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'false'
    && !document.querySelector('video').paused);
  assert.equal(await position(), 35.25);
  assert.equal(await timeline.getAttribute('aria-disabled'), null);
  await timeline.focus();
  await pressPad(page, 15);
  assert.equal(await page.locator('.seek-preview').count(), 1);
  await pressPad(page, 0);
  assert.equal(await position(), 45.25);
  checks.push('successful quality change restores the exact original position and makes directional seek/confirmation usable again');

  await page.evaluate(() => {
    window.reliability.holdResolve = true;
    const original = window.hub.resolve;
    window.hub.resolve = async (...args) => { await original(...args); throw new Error('清晰度请求失败'); };
  });
  await choosePlayerQuality(page, 80);
  await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'true');
  await timeline.focus();
  await change(70);
  await finish();
  await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'false');
  assert.equal(await position(), 45.25);
  assert.equal(await timeline.getAttribute('aria-disabled'), null);
  await change(60);
  assert.equal(await position(), 60);
  checks.push('failed replacement preserves original progress and re-enables pointer seeking');

  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
  await page.locator('.player-error').waitFor();
  assert.notEqual(await page.locator('.player-error p').evaluate(node => getComputedStyle(node).cursor), 'none');
  checks.push('the error page keeps a visible pointer when normal playback controls are hidden');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
