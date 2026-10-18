import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

const output = '.tmp/renderer-settings-parity';
await mkdir(output, { recursive: true });
const report = [];
for (const viewport of [{ width: 1440, height: 950 }, { width: 1920, height: 1080 }]) {
  for (const tv of [false, true]) {
    const snapshots = [];
    for (const platform of ['desktop', 'android']) {
      const install = new Function(`(${installReliabilityFixture})();
        window.reliability.failNextBootstrap = false;
        window.reliability.boot.preferences.tvMode = ${tv};
        window.hubPlatform = ${platform === 'android' ? "'android'" : 'undefined'};
      `);
      const { page, errors, close } = await launchHeadlessRenderer(viewport, install);
      try {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        const tabs = page.getByRole('tab');
        assert.deepEqual(await tabs.allTextContents(), ['观看', '弹幕', '手机遥控', '手柄']);
        await tabs.first().focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await tabs.nth(1).evaluate(node => node === document.activeElement), true);
        assert.equal(await tabs.first().getAttribute('aria-selected'), 'true');
        await page.keyboard.press('Enter');
        assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.getByRole('switch', { name: '显示 B 站视频弹幕', exact: true })
          .evaluate(node => node === document.activeElement), true);
        await page.keyboard.press('ArrowUp');
        assert.equal(await tabs.nth(1).evaluate(node => node === document.activeElement), true);
        const sections = [];
        for (const name of ['观看', '弹幕', '手机遥控', '手柄']) {
          await page.getByRole('tab', { name, exact: true }).click();
          const layout = await page.getByRole('dialog').evaluate(dialog => {
            const rect = dialog.getBoundingClientRect();
            const panel = dialog.querySelector('[role="tabpanel"]');
            return {
              overflow: dialog.scrollHeight - dialog.clientHeight,
              outside: rect.top < 0 || rect.bottom > innerHeight,
              width: rect.width, height: rect.height,
              controls: Array.from(panel.querySelectorAll('button, input, select')).map(node => {
                const bounds = node.getBoundingClientRect();
                return { name: node.getAttribute('aria-label') || node.textContent.trim(),
                  x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
              }),
            };
          });
          assert.ok(layout.overflow <= 1, `${platform}/${tv}/${name} must fit without scrolling`);
          assert.equal(layout.outside, false);
          sections.push({ name, ...layout });
          await page.screenshot({ path: `${output}/${viewport.width}-${tv}-${platform}-${name}.png` });
        }
        assert.equal(await page.getByRole('switch', { name: '允许手机遥控' }).count(), 0);
        assert.deepEqual(errors, []);
        snapshots.push(sections);
      } finally { await close(); }
    }
    assert.deepEqual(snapshots[0], snapshots[1], 'desktop and Android settings share identical geometry and controls');
    report.push({ viewport, tv, passed: true, checks: ['four short sections without scrolling',
      'directions move tabs; confirm switches; up/down enters and returns', 'desktop/Android control and geometry parity'] });
  }
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
