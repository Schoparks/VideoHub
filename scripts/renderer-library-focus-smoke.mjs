import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { installLibraryFixture } from './renderer-library-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-library-focus');
await mkdir(output, { recursive: true });
const checks = [];
for (const { tv, theme } of [
  { tv: false, theme: 'light' }, { tv: true, theme: 'light' },
  { tv: false, theme: 'dark' }, { tv: true, theme: 'dark' },
]) {
  for (const scenario of ['scan', 'file', 'home-add', 'home-empty', 'local-empty', 'navigation']) {
    const label = `${tv ? 'TV' : 'desktop'}-${theme}-${scenario}`;
    const { page, errors, close } = await launchHeadlessRenderer(tv
      ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
    const configure = value => page.evaluate(value => Object.assign(window.libraryTest, value), value);
    const finish = async mode => {
      await configure({ mode });
      await page.evaluate(() => { window.libraryTest.hold = false; window.libraryTest.finish(); });
      await page.waitForFunction(() => !document.querySelector('[data-local-library][aria-busy="true"]'));
    };
    const expectFocus = async target => {
      assert.equal(await target.evaluate(node => node === document.activeElement), true, `${label}: original entry lost focus`);
      assert.ok(await target.evaluate(node => parseFloat(getComputedStyle(node).outlineWidth) > 0));
      const visible = await target.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const clip = node.closest('main')?.getBoundingClientRect() || { top: 0, bottom: innerHeight };
        const style = getComputedStyle(node);
        const ring = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return rect.top - ring >= clip.top && rect.bottom + ring <= clip.bottom
          && (hit === node || node.contains(hit));
      });
      assert.equal(visible, true, `${label}: retained focus must remain visible and reachable`);
      const contrast = await target.evaluate(node => {
        const numbers = color => color.match(/[\d.]+/g)?.map(Number);
        let background = [255, 255, 255];
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const color = numbers(getComputedStyle(parent).backgroundColor);
          if (color && (color.length === 3 || color[3] === 1)) { background = color; break; }
        }
        const style = getComputedStyle(node);
        const opacity = Number(style.opacity);
        const ink = numbers(style.outlineColor).slice(0, 3)
          .map((value, index) => value * opacity + background[index] * (1 - opacity));
        const luminance = color => color.slice(0, 3).map(value => {
          const component = value / 255;
          return component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const a = luminance(ink), b = luminance(background);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      assert.ok(contrast >= 3, `${label}: waiting focus contrast ${contrast} must remain clear`);
    };
    try {
      await page.evaluate(installLibraryFixture);
      await page.evaluate(({ tv, theme, empty }) => {
        Object.assign(window.reliability.boot.preferences, { tvMode: tv, theme });
        if (empty) window.reliability.boot.library = [];
      }, { tv, theme, empty: scenario.includes('empty') });
      await page.getByRole('button', { name: '重试', exact: true }).click();
      if (['scan', 'local-empty', 'navigation'].includes(scenario)) {
        await page.getByRole('button', { name: '本地片库', exact: true }).click();
      }
      await connectPad(page);
      const name = ['scan', 'navigation'].includes(scenario) ? '重新扫描'
        : scenario === 'file' ? '打开文件' : scenario === 'home-add' ? '添加目录' : '添加视频目录';
      const target = page.getByRole('button', { name, exact: true });
      await configure({ hold: true, mode: 'error' });
      await target.focus();
      await pressPad(page, 0);
      await page.waitForFunction(() => !!window.libraryTest.finish);
      await page.waitForTimeout(200);
      await expectFocus(target);
      assert.equal(await target.getAttribute('aria-disabled'), 'true');
      assert.equal(await target.evaluate(node => node.disabled), false);
      await pressPad(page, 0);
      await target.evaluate(node => { node.click(); node.click(); });
      assert.equal(await page.evaluate(() => window.libraryTest.requests.length), 1);
      assert.equal(await page.evaluate(() => window.reliability.resolves.length), 0);
      checks.push(`${label}: pending entry retains visible focus and repeated confirms cannot import, scan or play again`);

      if (scenario === 'navigation') {
        const nav = page.getByRole('button', { name: '哔哩哔哩', exact: true });
        await nav.focus();
        await pressPad(page, 0);
        await finish('normal');
        await expectFocus(nav);
        assert.equal(await page.locator('.page-top h1').innerText(), '哔哩哔哩');
        checks.push(`${label}: completed scan updates committed library without reclaiming new navigation focus`);
      } else if (['file', 'home-add', 'local-empty'].includes(scenario)) {
        await finish('cancel');
        await expectFocus(target);
        assert.equal(await target.getAttribute('aria-disabled'), null);
        assert.equal(await page.locator('.toast').count(), 0);
        checks.push(`${label}: canceled selection restores the same entry without a success message or route change`);
      } else {
        await finish('error');
        await expectFocus(target);
        const error = page.locator('[data-local-library]').getByRole('alert');
        await error.filter({ hasText: '目录暂时不可读取' }).waitFor();
        const retry = error.getByRole('button', { name: '重试', exact: true });
        await configure({ hold: true });
        await retry.focus();
        await pressPad(page, 0);
        await page.waitForFunction(() => window.libraryTest.requests.length === 2);
        await page.waitForTimeout(200);
        await expectFocus(retry);
        assert.ok((await error.innerText()).includes('目录暂时不可读取'));
        await pressPad(page, 0);
        assert.equal(await page.evaluate(() => window.libraryTest.requests.length), 2);
        await page.screenshot({ path: resolve(output, `${label}-retry.png`) });
        await finish('error');
        await expectFocus(retry);
        if (scenario === 'home-empty') {
          await configure({ hold: true });
          await pressPad(page, 0);
          await page.waitForFunction(() => window.libraryTest.requests.length === 3);
          await finish('cancel');
          await expectFocus(retry);
          assert.ok((await error.innerText()).includes('目录暂时不可读取'));
          checks.push(`${label}: canceling a retry keeps its unresolved failure and original retry entry`);
        }
        const beforeSuccess = await page.evaluate(() => window.libraryTest.requests.length);
        await configure({ hold: true });
        await pressPad(page, 0);
        await page.waitForFunction(count => window.libraryTest.requests.length === count + 1, beforeSuccess);
        const scan = page.getByRole('button', { name: '重新扫描', exact: true });
        const moved = scenario === 'scan' ? scan : page.getByRole('button', { name: '本地片库', exact: true });
        await moved.focus();
        if (scenario !== 'scan') await pressPad(page, 0);
        await finish('normal');
        await expectFocus(moved);
        assert.equal(await page.locator('[data-local-library]').getByRole('alert').count(), 0);
        assert.equal(await page.evaluate(() => window.libraryTest.maximum), 1);
        checks.push(`${label}: failed retry preserves feedback and focus; confirmed success clears error without overriding later movement`);
      }
      assert.deepEqual(errors, []);
    } catch (error) {
      await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2));
      await page.screenshot({ path: resolve(output, `${label}-failure.png`) });
      throw error;
    } finally { await close(); }
  }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [], fixtureFilePicker: true, simulatedGamepad: true }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
