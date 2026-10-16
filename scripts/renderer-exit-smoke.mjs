import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-exit');
await mkdir(output, { recursive: true });
const checks = [];
for (const tvMode of [false, true]) {
  const { page, errors, close } = await launchHeadlessRenderer(tvMode
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const label = tvMode ? 'TV' : 'desktop';
  const click = name => page.getByRole('button', { name, exact: true }).evaluate(node => node.click());
  const releaseProgress = () => page.evaluate(() => {
    window.reliability.holdProgress = false;
    for (const finish of window.reliability.pendingProgress.splice(0)) finish();
  });
  try {
    await page.evaluate(tvMode => {
      const state = window.reliability;
      state.boot.preferences.tvMode = tvMode;
      state.windowFullscreen = !tvMode;
      state.windowCalls = [];
      window.hub.getFullscreen = async () => state.windowFullscreen;
      window.hub.fullscreen = async value => {
        state.windowCalls.push(value);
        if (state.holdWindowRestore) await new Promise(resolve => { state.finishWindowRestore = resolve; });
        state.windowFullscreen = value;
      };
    }, tvMode);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await connectPad(page);
    await page.locator('video').evaluate(video => { video.currentTime = 37.25; });
    await page.evaluate(() => {
      window.reliability.holdProgress = true;
      window.reliability.holdWindowRestore = true;
    });
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => window.reliability.pendingProgress.length > 0);
    await click('从头播放');
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 37.25);
    checks.push(`${label}: exiting cannot reset the position while its save is pending`);

    await page.locator('.player[data-exiting="true"]').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '退出播放');
    for (const name of ['播放设置', '显示弹幕', '播放队列', '播放速度', '清晰度', '选集，共 2 集', '下一集', '退出播放']) await click(name);
    const fullscreenName = tvMode ? '播放器全屏' : '退出播放器全屏';
    await click(fullscreenName);
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 9]) await pressPad(page, index);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 37.25);
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), 1);
    assert.equal(await page.evaluate(() => window.reliability.boot.preferences.danmaku), false);
    assert.deepEqual(await page.evaluate(() => window.reliability.windowCalls), []);
    assert.equal(await page.getByRole('button', { name: '退出播放', exact: true }).getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('.player .controller-focus-hint:not([hidden])').count(), 0);
    checks.push(`${label}: exit keeps its focused busy entry and isolates native clicks, controller shortcuts, settings and fullscreen`);

    await page.locator('video').evaluate(video => {
      video.dispatchEvent(new Event('ended'));
      video.dispatchEvent(new Event('error'));
    });
    assert.equal(await page.locator('.player-error').count(), 0);
    assert.equal(await page.locator('.playing-badge').innerText(), '正在退出');
    assert.equal(await page.getByRole('button', { name: '退出播放', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.screenshot({ path: resolve(output, tvMode ? 'television.png' : 'desktop.png') });
    checks.push(`${label}: late media completion/error cannot replace exit feedback or steal its focus`);

    await releaseProgress();
    await page.waitForFunction(() => !!window.reliability.finishWindowRestore);
    await click(fullscreenName);
    await click('退出播放');
    assert.deepEqual(await page.evaluate(() => window.reliability.windowCalls), [tvMode]);
    await page.evaluate(() => { window.reliability.holdWindowRestore = false; window.reliability.finishWindowRestore(); });
    await page.waitForFunction(() => !document.querySelector('.player'));
    await page.waitForFunction(() => document.activeElement?.matches('main .media-card'));
    assert.ok(await page.evaluate(() => window.reliability.progress.every(entry => entry.position === 37.25)));
    assert.equal(await page.evaluate(() => window.reliability.windowFullscreen), tvMode);
    checks.push(`${label}: save and window restoration finish once, retain the original progress and return to the card`);

    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
    await page.getByRole('button', { name: '重试', exact: true }).waitFor();
    await page.evaluate(() => { window.reliability.holdProgress = true; });
    await page.getByRole('button', { name: '返回浏览', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '返回浏览');
    const requests = await page.evaluate(() => window.reliability.resolves.length);
    await click('重试');
    await click('选择清晰度');
    await pressPad(page, 0);
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), requests);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.getByRole('button', { name: '返回浏览', exact: true }).getAttribute('aria-busy'), 'true');
    await releaseProgress();
    await page.waitForFunction(() => !document.querySelector('.player'));
    checks.push(`${label}: returning from an error blocks retry/quality and preserves the return entry while saving`);

    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await page.evaluate(() => { window.reliability.holdProgress = true; });
    await pressPad(page, 1);
    await page.locator('.player:not(.controls-visible)').waitFor();
    await pressPad(page, 1);
    await page.locator('.player.controls-visible[data-exiting="true"]').waitFor();
    await page.getByRole('button', { name: '退出播放', exact: true }).waitFor();
    await releaseProgress();
    await page.waitForFunction(() => !document.querySelector('.player'));
    assert.deepEqual(errors, []);
    checks.push(`${label}: B still hides first, then reveals exit status only while the return is actually pending`);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
