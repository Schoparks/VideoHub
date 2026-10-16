import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-error-quality');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const opener = page.getByRole('button', { name: '选择清晰度', exact: true });
const menu = page.getByRole('dialog', { name: '清晰度', exact: true });
const focused = locator => locator.evaluate(node => node === document.activeElement);
const paused = () => page.locator('video').evaluate(video => video.paused);
const requests = () => page.evaluate(() => window.reliability.resolves.length);
const fail = async () => {
  await page.locator('video').evaluate(video => {
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 3 } });
    video.dispatchEvent(new Event('error'));
  });
  await opener.waitFor();
  assert.match(await page.locator('.player-error').textContent(), /HEVC：系统声明硬解、内核未确认支持/);
};
const open = async () => { await opener.focus(); await pressPad(page, 0); await menu.waitFor(); };
const choose = async quality => {
  await open();
  await page.waitForFunction(() => document.querySelector('.player-option-panel .controller-focus-hint')?.textContent.includes('取消'));
  assert.equal(await menu.locator('.controller-focus-hint').isVisible(), true);
  await menu.locator(`[data-option-id="${quality}"]`).focus();
  await pressPad(page, 0);
  await menu.waitFor({ state: 'detached' });
};

try {
  await page.evaluate(() => {
    const original = window.hub.resolve;
    window.hub.resolve = async (...args) => {
      const source = await original(...args);
      source.videoCodec = 'H.264';
      source.videoCapabilities = [
        { codec: 'H.264', mse: true, decoder: 2 },
        { codec: 'HEVC', mse: false, decoder: 2 },
        { codec: 'AV1', mse: false, decoder: 0 },
      ];
      if (window.qualityFails) throw new Error('清晰度请求失败');
      return window.noQualities ? { ...source, qualities: [] } : source;
    };
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.getByRole('button', { name: '播放速度', exact: true }).click();
  await page.getByRole('button', { name: '2×', exact: true }).click();
  await page.locator('video').evaluate(video => { video.currentTime = 42.75; });
  await fail();
  await connectPad(page);
  const before = await requests();
  await open();
  assert.equal(await page.locator('.player-error').evaluate(node => node.inert), true);
  assert.equal(await focused(menu.locator('[data-option-id="80"]')), true);
  await pressPad(page, 13);
  await pressPad(page, 9);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.player-option-panel')), true);
  assert.equal(await paused(), true);
  assert.equal(await requests(), before);
  await pressPad(page, 1);
  await menu.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.textContent === '选择清晰度');
  assert.equal(await focused(opener), true);
  assert.equal(await page.locator('.player-error .controller-focus-hint').isVisible(), true);
  assert.equal(await paused(), true);
  checks.push('error quality menu isolates background/shortcuts; A opens, direction navigates and B cancels to its opener without resuming');

  await choose(64);
  await page.waitForFunction(() => !document.querySelector('.player-error') && !document.querySelector('video').paused);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 42.75);
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 2);
  assert.deepEqual(await page.evaluate(() => {
    const { part, quality } = window.reliability.resolves.at(-1);
    return { part, quality };
  }), { part: 'cid:1', quality: 64 });
  checks.push('confirmed alternate quality reparses the same part, restores exact progress/rate and starts a fresh playable session');

  await fail();
  const same = await requests();
  await choose(64);
  await page.waitForFunction(() => !document.querySelector('.player-error') && !document.querySelector('video').paused);
  assert.equal(await requests(), same + 1);
  checks.push('confirming the current quality on the error page also retries instead of silently doing nothing');

  await fail();
  await page.evaluate(() => { window.qualityFails = true; window.reliability.holdResolve = true; });
  await choose(80);
  await page.waitForFunction(() => !!window.reliability.finishResolve);
  await page.waitForFunction(() => document.activeElement?.textContent === '选择清晰度');
  const pending = await requests();
  await pressPad(page, 0);
  assert.equal(await menu.count(), 0);
  assert.equal(await requests(), pending);
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'false');
  assert.equal(await paused(), true);
  assert.equal(await focused(opener), true);
  assert.equal(await page.locator('.player-error').count(), 1);
  await open();
  await pressPad(page, 1);
  checks.push('pending quality recovery retains its opener and rejects repeated A; failed requests preserve error/position and remain editable');

  await page.evaluate(() => { window.qualityFails = false; window.reliability.holdResolve = true; });
  await choose(80);
  await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'true');
  await pressPad(page, 1);
  await page.waitForFunction(() => !document.querySelector('.player'));
  await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.player').count(), 0);
  checks.push('B cancels a pending recovery and late resolution cannot reopen playback');

  await page.evaluate(() => { window.noQualities = true; });
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
  await page.locator('.player-error').waitFor();
  assert.equal(await opener.count(), 0);
  checks.push('sources without server-provided quality options show only usable retry/return actions');
  await page.getByRole('button', { name: '返回浏览', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));

  await page.evaluate(() => { window.noQualities = false; });
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await fail();
  for (const [width, height, tv] of [[1440, 950, false], [1920, 1080, true]]) {
    if (tv) {
      await page.getByRole('button', { name: '返回浏览', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.player'));
      await page.getByRole('button', { name: '切换电视模式', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.tv === 'true');
      await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
      await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
      await fail();
    }
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.player-overlay')).opacity === '0');
    await opener.focus();
    const bounds = await page.locator('.player-error button').evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { visible: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        hit: button.contains(hit) };
    }));
    assert.ok(bounds.every(button => button.visible && button.hit), JSON.stringify(bounds));
    await page.screenshot({ path: resolve(output, `${width}-error.png`), animations: 'disabled' });
    await open();
    await page.screenshot({ path: resolve(output, `${width}-menu.png`), animations: 'disabled' });
    await pressPad(page, 1);
  }
  checks.push('desktop and TV error actions/menu remain visible and hit-testable');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
