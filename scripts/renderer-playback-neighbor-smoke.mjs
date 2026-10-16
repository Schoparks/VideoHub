import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-playback-neighbor');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  for (const scenario of ['middle', 'last', 'reordered', 'replaced', 'empty']) {
    const mode = tv ? 'TV' : 'desktop';
    const { page, errors, close } = await launchHeadlessRenderer(tv
      ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
    try {
      await page.evaluate(() => {
        window.reliability.boot.queue = Array.from({ length: 40 }, (_, index) => ({
          ...window.reliability.boot.queue[0], id: `queue:${index}`, title: `队列视频 ${index + 1}`,
        }));
      });
      await page.getByRole('button', { name: '重试', exact: true }).click();
      if (tv) {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByRole('switch', { name: '电视模式', exact: true }).click();
        await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      }
      await page.getByRole('button', { name: '我的收藏', exact: true }).click();
      await page.locator('main').getByRole('button', { name: /^播放队列/ }).click();
      await connectPad(page);
      const index = scenario === 'last' ? 39 : 20;
      const title = `队列视频 ${index + 1}`;
      await page.locator('main').getByRole('button', { name: `播放 ${title}`, exact: true }).click();
      await page.waitForFunction(() => document.querySelector('video')?.paused === false);
      await page.getByRole('button', { name: '播放队列', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '播放队列', exact: true });
      if (scenario === 'reordered') {
        for (let move = 0; move < index; move++) {
          await dialog.getByRole('button', { name: `上移 ${title}`, exact: true }).click();
          await page.waitForFunction(() => document.querySelector('.queue-list[aria-busy="true"]') === null);
        }
      } else if (scenario === 'empty') {
        while (await dialog.locator('.queue-row').count()) {
          await dialog.getByRole('button', { name: /^移除/ }).first().click();
          await page.waitForFunction(() => document.querySelector('.queue-list[aria-busy="true"]') === null);
        }
      } else {
        await dialog.getByRole('button', { name: `移除 ${title}`, exact: true }).click();
        await dialog.getByRole('button', { name: `移除 ${title}`, exact: true }).waitFor({ state: 'detached' });
      }
      if (scenario === 'replaced') {
        // Simulate list DOM replacement while retaining the survivor's public identity.
        await page.locator('main').getByRole('button', { name: '播放 队列视频 22', exact: true })
          .evaluate(node => node.replaceWith(node.cloneNode(true)));
      }
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      assert.equal(await page.locator('video').evaluate(video => video.paused), false);
      await page.getByRole('button', { name: '退出播放', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.player'));
      await page.waitForTimeout(150);
      await pressPad(page, 9); // Start has no browse action and restores actual controller presentation.
      const expected = ['middle', 'replaced'].includes(scenario) ? '播放 队列视频 22'
        : scenario === 'last' ? '播放 队列视频 39' : scenario === 'reordered' ? `播放 ${title}` : null;
      const state = await page.evaluate(() => {
        const active = document.activeElement;
        const main = document.querySelector('main').getBoundingClientRect();
        const rect = active?.getBoundingClientRect();
        const style = getComputedStyle(active);
        const outline = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
        return { name: active?.getAttribute('aria-label'), connected: active?.isConnected,
          valid: !active?.closest('[inert], [hidden]'), outline,
          main: main.toJSON(), rect: rect.toJSON(),
          visible: rect.top - outline >= main.top && rect.bottom + outline <= main.bottom };
      });
      if (expected) {
        if (!state.visible) {
          await writeFile(resolve(output, 'outline-failure.json'), JSON.stringify({ mode, scenario, state }, null, 2));
          await page.screenshot({ path: resolve(output, 'outline-failure.png') });
        }
        assert.equal(state.name, expected, `${mode}/${scenario}: return must stay with the playing item or its nearest survivor`);
        assert.equal(state.visible, true, 'the returned focus must remain in the browse viewport');
        assert.ok(state.outline > 0, 'controller focus must retain its visible outer border');
      } else {
        assert.equal(state.connected && state.valid, true);
        assert.ok(await page.getByText('播放队列为空', { exact: true }).count());
      }
      checks.push(`${mode}/${scenario}: return uses the playing item or an adjacent survivor with visible focus and safe empty fallback`);
      if (scenario === 'reordered') await page.screenshot({ path: resolve(output, `${mode}.png`) });
      assert.deepEqual(errors, []);
    } finally { await close(); }
  }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, simulatedMedia: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
