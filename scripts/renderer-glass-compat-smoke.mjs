import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

const output = '.tmp/renderer-glass-compat';
await mkdir(output, { recursive: true });
const report = [];
for (const tv of [false, true]) {
  for (const theme of ['light', 'dark']) {
    const install = new Function(`(${installReliabilityFixture})();
      window.reliability.failNextBootstrap = false;
      Object.assign(window.reliability.boot.preferences, { tvMode: ${tv}, theme: '${theme}' });
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (...args) => args.some(arg => /backdrop-filter/.test(arg)) ? false : supports(...args);
    `);
    const { page, errors, close } = await launchHeadlessRenderer(tv
      ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, install);
    const label = `${tv ? 'tv' : 'desktop'}-${theme}`;
    const material = selector => page.locator(selector).first().evaluate(node => {
      const style = getComputedStyle(node);
      return { color: style.color, background: style.backgroundColor, image: style.backgroundImage,
        filter: style.filter, backdrop: style.backdropFilter, shadow: style.boxShadow };
    });
    try {
      await page.getByRole('button', { name: '设置', exact: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('data-glass-material'), 'fallback');
      assert.equal((await material('.app-shell')).filter, 'none');
      assert.match((await material('.navigation-bar nav')).image, /linear-gradient/);
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.app-shell')?.dataset.glassBlurred === 'true');
      assert.match((await material('.app-shell')).filter, /blur\(6px\)/);
      assert.equal((await material('.modal')).filter, 'none');
      assert.equal((await material('.modal')).backdrop, 'none');
      assert.match((await material('.modal')).background, /^rgba\(/);
      assert.match((await material('.setting-row')).background, /^rgba\(/);
      assert.notEqual((await material('.modal')).shadow, 'none');
      const before = await page.getByRole('dialog').boundingBox();
      const cdp = await page.context().newCDPSession(page);
      for (const name of ['prefers-reduced-transparency', 'prefers-contrast']) {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name, value: name.includes('contrast') ? 'more' : 'reduce' }] });
        assert.equal((await material('.app-shell')).filter, 'none');
        assert.match((await material('.modal')).background, /^rgb\(/);
        assert.deepEqual(await page.getByRole('dialog').boundingBox(), before);
      }
      await cdp.send('Emulation.setEmulatedMedia', { features: [] });
      await page.getByRole('switch', { name: '深色外观', exact: true }).focus();
      await page.screenshot({ path: `${output}/${label}-settings.png` });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.app-shell')?.hasAttribute('data-glass-blurred'));
      await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).first().click();
      await page.waitForFunction(() => document.querySelector('video')?.paused === false);
      assert.equal((await material('.app-shell')).filter, 'none');
      assert.equal((await material('video')).filter, 'none');
      assert.equal((await material('.player')).filter, 'none');
      assert.match((await material('.player-bottom')).background, /^rgba\(/);
      assert.match((await material('.player-bottom')).image, /linear-gradient/);
      assert.equal(await page.locator('.glass-optics filter').count(), 0);
      await page.getByRole('button', { name: '播放设置', exact: true }).click();
      assert.equal((await material('video')).filter, 'none');
      assert.equal((await material('.app-shell')).filter, 'none');
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      const toggle = await page.getByRole('button', { name: '暂停', exact: true }).count() ? '暂停' : '继续播放';
      await page.getByRole('button', { name: toggle, exact: true }).focus();
      await page.screenshot({ path: `${output}/${label}-player.png` });
      await page.getByRole('button', { name: '播放速度', exact: true }).click();
      assert.match((await material('.player-option-panel')).background, /^rgba\(/);
      assert.equal((await material('.player-option-panel')).filter, 'none');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.player-option-panel'));
      assert.deepEqual(errors, []);
      report.push({ label, passed: true, checks: ['capability fallback', 'translucent gradient and rim',
        'inactive browse blur only; release on dismissal', 'opaque accessibility without layout changes',
        'video and foreground stay unfiltered; player/menu use tinted glass; no SVG refraction'] });
    } finally { await close(); }
  }
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
