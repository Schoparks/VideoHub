import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { installQualityFixture } from './renderer-bilibili-quality-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = '.tmp/renderer-bilibili-quality';
await mkdir(output, { recursive: true });
const report = [];
for (const [width, height, tv] of [[1440, 950, false], [1920, 1080, true]]) {
  const install = new Function(`(${installReliabilityFixture})(); (${installQualityFixture})();
    window.reliability.boot.preferences.tvMode = ${tv};
    window.hubPlatform = ${tv ? "'android'" : 'undefined'};
  `);
  const { page, errors, close } = await launchHeadlessRenderer({ width, height }, install);
  const checks = [];
  const cap = page.getByRole('combobox', { name: 'B 站清晰度上限', exact: true });
  const mode = page.getByRole('combobox', { name: 'B 站清晰度选择', exact: true });
  const closeSettings = () => page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  const currentQuality = async value => {
    await page.waitForFunction(value => document.querySelector('[data-player-choice="quality"]')
      ?.getAttribute('data-option-value') === String(value) && document.querySelector('.player')?.dataset.switching === 'false', value);
  };
  const choose = async value => {
    await page.getByRole('button', { name: '清晰度', exact: true }).click();
    await page.locator(`[data-option-id="${value}"]`).click();
  };
  const memory = () => page.evaluate(() => window.reliability.boot.preferences.bilibiliRememberedQuality);
  const play = async () => {
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.locator('video').waitFor();
  };
  const leave = async () => {
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.locator('.player').waitFor({ state: 'detached' });
  };
  try {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    assert.equal(await cap.inputValue(), '0');
    assert.equal(await mode.inputValue(), 'highest');
    assert.deepEqual(await cap.locator('option').allTextContents(), [
      '不限', '4K', '1080P', '720P', '480P', '360P', '240P',
    ]);
    await connectPad(page);
    await cap.focus();
    await pressPad(page, 0);
    await pressPad(page, 15);
    await pressPad(page, 15);
    await pressPad(page, 1);
    assert.equal(await cap.inputValue(), '80');
    await page.keyboard.press('ArrowDown');
    assert.equal(await mode.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    assert.equal(await mode.inputValue(), 'remember');
    const layout = await page.getByRole('dialog').evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return { outside: rect.top < 0 || rect.bottom > innerHeight,
        overflow: dialog.scrollHeight - dialog.clientHeight };
    });
    assert.equal(layout.outside, false);
    assert.ok(layout.overflow <= 1);
    await page.screenshot({ path: `${output}/${width}-settings.png` });
    await closeSettings();
    checks.push('resolution cap options, gamepad/keyboard edit and return, full settings layout');

    await play();
    await currentQuality(116);
    await page.getByRole('button', { name: '清晰度', exact: true }).click();
    assert.deepEqual(await page.locator('[data-option-id]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.optionId))), [116, 112, 80, 64]);
    await page.keyboard.press('Escape');
    assert.equal(await memory(), 0);
    await page.evaluate(() => { window.reliability.nextActualQuality = 80; });
    await choose(112);
    await currentQuality(80);
    await page.waitForFunction(() => window.reliability.boot.preferences.bilibiliRememberedQuality === 112);
    await leave();
    await page.evaluate(() => { window.reliability.available = [120, 116, 80, 64]; });
    await play();
    await currentQuality(116);
    assert.equal(await memory(), 112);
    await page.evaluate(() => { window.reliability.available = [120, 116, 112, 80, 64]; });
    await page.getByRole('button', { name: '下一集', exact: true }).click();
    await currentQuality(112);
    assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).explicit), undefined);
    checks.push('menu cap, canceled choice is not remembered, manual requested tier survives server fallback and returns on next episode');

    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await mode.selectOption('highest');
    await closeSettings();
    await page.getByRole('button', { name: '上一集', exact: true }).click();
    await currentQuality(116);
    await choose(80);
    await currentQuality(80);
    assert.equal(await memory(), 112);
    await page.getByRole('button', { name: '下一集', exact: true }).click();
    await currentQuality(116);
    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await mode.selectOption('remember');
    await closeSettings();
    const before = await page.evaluate(() => window.reliability.resolves.length);
    await choose(116);
    await page.waitForFunction(() => window.reliability.boot.preferences.bilibiliRememberedQuality === 116);
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), before);
    checks.push('highest applies to previous/next episodes; manual current-tier confirmation remembers without media reload');

    await page.evaluate(() => { window.reliability.failResolve = true; });
    await choose(112);
    await page.getByText('清晰度解析失败', { exact: true }).waitFor();
    assert.equal(await memory(), 116);
    await page.evaluate(() => { window.reliability.failResolve = false; window.reliability.failPreferences = true; });
    await choose(80);
    await currentQuality(80);
    await page.getByText('设置保存失败', { exact: true }).waitFor();
    assert.equal(await memory(), 116);
    await leave();
    await play();
    await currentQuality(116);
    checks.push('failed resolve never records memory; failed memory save rolls back for subsequent playback');

    await page.evaluate(() => { window.reliability.holdResolve = true; });
    await choose(112);
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    await leave();
    await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
    await page.waitForFunction(() => window.reliability.releases.includes(window.reliability.resolves.at(-1).sessionId));
    assert.equal(await memory(), 116);
    assert.equal(await page.locator('video').count(), 0);
    await play();
    await currentQuality(116);
    checks.push('canceling an in-flight quality switch releases its late session and never overwrites memory');

    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await cap.selectOption('64');
    await closeSettings();
    await page.getByRole('button', { name: '清晰度', exact: true }).click();
    assert.deepEqual(await page.locator('[data-option-id]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.optionId))), [64]);
    await page.keyboard.press('Escape');
    await leave();
    await play();
    await currentQuality(64);
    await leave();
    checks.push('lowering the cap filters an existing player menu and applies on reopening');

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.evaluate(() => { window.reliability.holdPreferences = true; });
    await cap.selectOption('80');
    await page.waitForFunction(() => !!window.reliability.finishPreferences);
    await closeSettings();
    const waiting = await page.evaluate(() => window.reliability.resolves.length);
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '取消准备播放', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), waiting);
    await page.getByRole('button', { name: '取消准备播放', exact: true }).click();
    await page.evaluate(() => { window.reliability.holdPreferences = false; window.reliability.finishPreferences(); });
    await page.waitForFunction(() => window.reliability.boot.preferences.bilibiliMaxQuality === 80);
    assert.equal(await page.locator('video').count(), 0);
    await play();
    await currentQuality(116);
    checks.push('opening waits for pending preference persistence; cancel prevents a late playback');

    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await mode.selectOption('highest');
    await page.getByRole('combobox', { name: '播完后', exact: true }).selectOption('next');
    await closeSettings();
    for (const step of ['episode', 'queue']) {
      await choose(80);
      await currentQuality(80);
      const count = await page.evaluate(() => window.reliability.resolves.length);
      await page.locator('video').evaluate(video => {
        video.currentTime = 120;
        video.pause();
        video.dispatchEvent(new Event('ended'));
      });
      await currentQuality(116);
      assert.equal(await page.evaluate(() => window.reliability.resolves.length), count + 1, step);
      assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).explicit), undefined);
    }
    checks.push('automatic episode continuation and queue continuation both reselect the highest permitted tier');
    assert.deepEqual(errors, []);
    report.push({ width, height, tv, checks });
  } finally { await close(); }
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
