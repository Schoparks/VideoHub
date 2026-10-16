import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-playback');
await mkdir(output, { recursive: true });
const session = await launchHeadlessRenderer({ width: 1920, height: 1080 }, installReliabilityFixture);
const { page, errors } = session;
const checks = [];

async function assertControls(label) {
  const measurement = await page.locator('.player-overlay').evaluate(overlay => {
    const nodes = [...overlay.querySelectorAll('button, input, select, [tabindex]')];
    return nodes.map(node => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { name: node.getAttribute('aria-label') || node.textContent.slice(0, 30),
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        reachable: !!hit && (node === hit || node.contains(hit)) };
    });
  });
  const viewport = page.viewportSize();
  for (const [index, control] of measurement.entries()) {
    assert.ok(control.left >= 0 && control.right <= viewport.width, `${label}: horizontal clip ${control.name}`);
    assert.ok(control.top >= 0 && control.bottom <= viewport.height, `${label}: vertical clip ${control.name}`);
    assert.equal(control.reachable, true, `${label}: covered control ${control.name}`);
    for (const other of measurement.slice(index + 1)) {
      const overlap = Math.min(control.right, other.right) - Math.max(control.left, other.left) > 1
        && Math.min(control.bottom, other.bottom) - Math.max(control.top, other.top) > 1;
      assert.equal(overlap, false, `${label}: overlapping ${control.name} / ${other.name}`);
    }
  }
}

try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '电视模式', exact: true }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.evaluate(() => {
    window.reliability.itemOverride = { id: 'bili:reliability', source: 'bilibili', kind: 'video', aid: 42,
      title: '长标题完整阅读与观看信息验证 '.repeat(70) + '标题结尾' };
    window.reliability.partsOverride = [1, 2].map(id => ({ id: `cid:${id}`, cid: id,
      title: `测试第 ${id} 集 · ${'长分集标题 '.repeat(95)}信息结尾` }));
  });
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('video') && !document.querySelector('video').paused);
  await connectPad(page);
  const title = page.locator('.player-overlay h2');
  const info = page.locator('.player-overlay header p');
  assert.equal(await title.evaluate(node => getComputedStyle(node).fontSize), '28px');
  assert.ok((await title.textContent()).endsWith('标题结尾'));
  assert.ok((await info.textContent()).includes('信息结尾'));
  assert.equal(await title.evaluate(node => node.tabIndex), -1);
  assert.equal(await info.evaluate(node => node.tabIndex), -1);
  const pause = page.getByRole('button', { name: '暂停', exact: true });
  assert.equal(await pause.evaluate(node => {
    node.focus();
    document.querySelector('.player-overlay h2').focus();
    document.querySelector('.player-overlay header p').focus();
    return node === document.activeElement;
  }), true);
  checks.push('TV text is enlarged and retains complete content; pure title and source do not steal actionable focus');
  await assertControls('TV controls');
  await page.screenshot({ path: resolve(output, 'player-tv.png') });
  checks.push('TV controls have no clipped, overlapping or covered targets');

  const settings = page.getByRole('button', { name: '播放设置', exact: true });
  await settings.focus();
  await pressPad(page, 0);
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.locator('.player').evaluate(node => node.inert), true);
  await pressPad(page, 1);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放设置');
  const toggle = page.getByRole('button', { name: '显示弹幕', exact: true });
  await toggle.focus();
  await pressPad(page, 0);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => document.querySelector('.controller-actions')?.textContent.includes('已开启'));
  assert.ok((await page.locator('.controller-actions').innerText()).includes('已开启'));
  const activeBackground = await toggle.evaluate(node => getComputedStyle(node).backgroundColor);
  await pressPad(page, 0);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.notEqual(await toggle.evaluate(node => getComputedStyle(node).backgroundColor), activeBackground);
  checks.push('gamepad opens settings, returns to its opener and toggles danmaku with visible state and matching hints');

  await page.getByRole('button', { name: '下一集', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.player-overlay header p')?.textContent.includes('测试第 2 集'));
  assert.equal(await title.evaluate(node => node.tabIndex), -1);
  assert.equal(await info.evaluate(node => node.tabIndex), -1);
  checks.push('changing episodes updates source information without introducing title focus');
  await page.getByRole('button', { name: '播放设置', exact: true }).click();
  await page.getByRole('switch', { name: '电视模式', exact: true }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 950 });
  await assertControls('desktop controls');
  await page.screenshot({ path: resolve(output, 'player-desktop.png') });
  checks.push('normal desktop controls remain reachable with long title, episode list, rate, quality and danmaku controls');
  await settings.focus();
  await page.waitForTimeout(5500);
  assert.equal(await page.locator('.player').evaluate(node => node.classList.contains('controls-visible')), false);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('.player.controls-visible'));
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '暂停');
  assert.ok(await page.getByRole('button', { name: '暂停', exact: true }).evaluate(node => node === document.activeElement));
  checks.push('controls still auto-hide and Tab restores active playback controls');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.player:not(.controls-visible)'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.player'));
  assert.deepEqual(errors, []);
  const result = { result: 'passed', headless: true, simulatedMedia: true, simulatedGamepad: true, checks, errors };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await session.close();
}
