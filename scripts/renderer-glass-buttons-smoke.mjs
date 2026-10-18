import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

const output = '.tmp/renderer-glass-buttons';
await mkdir(output, { recursive: true });
const report = [];
for (const platform of ['desktop', 'android']) {
  for (const theme of ['light', 'dark']) {
    const install = new Function(`(${installReliabilityFixture})();
      window.reliability.failNextBootstrap = false;
      Object.assign(window.reliability.boot.preferences, { tvMode: true, theme: '${theme}' });
      window.hubPlatform = ${platform === 'android' ? "'android'" : 'undefined'};
      ${platform === 'android' ? `const supports = CSS.supports.bind(CSS);
      CSS.supports = (...args) => args.some(arg => /backdrop-filter/.test(arg)) ? false : supports(...args);` : ''}
    `);
    const { page, errors, close } = await launchHeadlessRenderer({ width: 1920, height: 1080 }, install);
    const label = `${platform}-${theme}`;
    try {
      await page.getByRole('button', { name: '设置', exact: true }).waitFor();
      const standalone = page.getByRole('button', { name: '打开链接', exact: true });
      assert.equal(await standalone.getAttribute('data-glass-button'), 'regular');
      const texture = await standalone.evaluate(node => ({
        rim: getComputedStyle(node, '::before').boxShadow,
        film: getComputedStyle(node).backgroundImage,
        light: getComputedStyle(node, '::after').backgroundImage,
        pointerEvents: getComputedStyle(node, '::after').pointerEvents,
        backdrop: getComputedStyle(node).backdropFilter,
      }));
      assert.match(texture.rim, /inset/);
      assert.match(texture.film, /linear-gradient/);
      assert.match(texture.light, /radial-gradient/);
      assert.equal(texture.pointerEvents, 'none');
      if (platform === 'desktop') assert.match(texture.backdrop, /url\(/);
      else assert.equal(texture.backdrop, 'none');
      await page.screenshot({ path: `${output}/${label}-home.png` });
      await standalone.click();
      await page.getByRole('dialog', { name: '打开链接', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const viewing = page.getByRole('tab', { name: '观看', exact: true });
      const before = await viewing.boundingBox();
      const pressed = await viewing.evaluate(node => {
        node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11, button: 0, clientX: 1, clientY: 1 }));
        return node.dataset.glassPressed;
      });
      assert.equal(pressed, 'true');
      await viewing.dispatchEvent('pointercancel', { pointerId: 11, bubbles: true });
      assert.equal(await viewing.getAttribute('data-glass-pressed'), null);
      assert.deepEqual(await viewing.boundingBox(), before);
      await viewing.focus();
      await page.keyboard.press('Enter');
      assert.equal(await viewing.getAttribute('data-glass-pressed'), 'true');
      await page.waitForFunction(() => !document.querySelector('[data-glass-pressed]'));
      const acknowledged = await viewing.evaluate(node => {
        node.focus();
        window.dispatchEvent(new CustomEvent('hub-controller-action', { detail: 'confirm', cancelable: true }));
        return { pressed: node.dataset.glassPressed, focus: node === document.activeElement,
          outline: getComputedStyle(node).outlineWidth };
      });
      assert.deepEqual(acknowledged, { pressed: 'true', focus: true, outline: '2px' });
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await viewing.getAttribute('data-glass-pressed'), null);
      await page.screenshot({ path: `${output}/${label}-settings.png` });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).first().click();
      await page.waitForFunction(() => document.querySelector('video')?.paused === false);
      const pause = page.getByRole('button', { name: '暂停', exact: true });
      assert.equal(await pause.getAttribute('data-glass-button'), 'playback');
      assert.match(await pause.evaluate(node => getComputedStyle(node).backgroundImage), /linear-gradient/);
      await pause.click();
      await page.waitForFunction(() => document.querySelector('video')?.paused === true);
      const blocked = page.locator('.player-buttons button:disabled').first();
      if (await blocked.count()) {
        await blocked.evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await blocked.getAttribute('data-glass-pressed'), null);
      }
      await page.waitForFunction(() => !document.querySelector('[data-glass-pressed]'));
      await page.screenshot({ path: `${output}/${label}-player.png` });
      assert.deepEqual(errors, []);
      report.push({ label, passed: true, checks: ['thin fill, rim and light layers',
        'pointer cancel; keyboard and semantic confirmation feedback', 'same bounds and single focus outline',
        'blur clears press; unavailable action does not light', 'real existing pause action without duplicate dispatch'] });
    } finally { await close(); }
  }
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
