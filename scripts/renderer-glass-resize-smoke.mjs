import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

const output = resolve('.tmp/renderer-glass-resize');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer(
  { width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.paused === false);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const video = await page.locator('video').elementHandle();
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.resizeMaps = 0;
    const encode = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      window.resizeMaps++;
      return encode.apply(this, args);
    };
  });
  for (let step = 1; step <= 12; step++) {
    await page.setViewportSize({ width: 1440 + step * 40, height: 950 + step * 10 });
    await page.waitForTimeout(25);
  }
  const during = await page.evaluate(() => window.resizeMaps);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.resizeMaps);
  assert.ok(during <= 4, `continuous resize rebuilt ${during} displacement maps`);
  assert.ok(after <= 10, `one resize burst rebuilt ${after} displacement maps`);
  assert.ok(after > during, 'resting size must regain optical detail');
  assert.equal(await video.evaluate(node => node === document.querySelector('video') && node.paused), true);
  for (const selector of ['.player-overlay > header', '.player-bottom']) {
    const result = await page.locator(selector).evaluate(node => {
      const id = node.style.getPropertyValue('--glass-optics').match(/#([^\"]+)/)?.[1];
      const filter = id && document.getElementById(id);
      return { width: Math.round(node.getBoundingClientRect().width), filterWidth: Number(filter?.getAttribute('width')) };
    });
    assert.equal(result.filterWidth, result.width);
  }
  checks.push('resize burst defers displacement encoding until resting size, without replacing or resuming media');
  checks.push('player glass filters match final viewport dimensions');
  await page.screenshot({ path: resolve(output, 'player-final.png') });
  assert.deepEqual(errors, []);
  const report = { during, after, checks, errors };
  await writeFile(resolve(output, 'checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await close(); }
