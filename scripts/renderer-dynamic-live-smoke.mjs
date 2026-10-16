import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { build } from 'esbuild';

const output = '.tmp/renderer-dynamic-live';
await mkdir(output, { recursive: true });
await build({ entryPoints: ['electron/providers/bilibili.ts'], bundle: true, platform: 'node',
  format: 'esm', outfile: '.tmp/dynamic-live-test-module.mjs' });
const { normalizeDynamic } = await import('../.tmp/dynamic-live-test-module.mjs');
const entry = normalizeDynamic({ id_str: '123', modules: {
  module_author: { name: '直播测试作者', pub_ts: 1700000000 },
  module_dynamic: { major: { live_rcmd: { content: JSON.stringify({ live_play_info: {
    room_id: 5441, title: '直播通知测试', live_status: 1, cover: 'https://fixture.invalid/live.png',
  } }) } } },
} });
const reports = [];
for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 950 }]) {
  const session = await launchHeadlessRenderer(viewport, installReliabilityFixture);
  const { page, errors } = session;
  try {
    await page.route('https://fixture.invalid/live.png', route => route.fulfill({ contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jipkAAAAASUVORK5CYII=', 'base64') }));
    await page.evaluate(({ entry, tv }) => {
      window.reliability.boot.preferences.tvMode = tv;
      const browse = window.hub.browse;
      window.hub.browse = request => request.kind === 'dynamic'
        ? Promise.resolve({ dynamics: [entry], items: [entry.video], hasMore: false }) : browse(request);
      const resolve = window.hub.resolve;
      window.hub.resolve = async (item, ...args) => {
        window.reliability.lastOpened = item;
        return resolve(item, ...args);
      };
    }, { entry, tv: viewport.width === 1920 });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '哔哩哔哩', exact: true }).click();
    await page.getByRole('button', { name: '关注动态', exact: true }).click();
    const card = page.getByRole('button', { name: '播放 直播通知测试', exact: true });
    await card.waitFor();
    await page.waitForFunction(() => document.querySelector('.dynamic-feed img')?.complete);
    assert.equal(await card.locator('img').evaluate(img => img.naturalWidth > 0), true);
    assert.equal(await card.getAttribute('data-media-id'), 'live:5441');
    assert.ok((await card.textContent()).includes('直播中'));
    await card.focus();
    await page.keyboard.press('Enter');
    await page.locator('.player').waitFor();
    assert.equal(await page.evaluate(() => window.reliability.lastOpened.roomId), 5441);
    assert.equal(await page.evaluate(() => window.reliability.lastOpened.kind), 'live');
    await page.locator('[data-player-leave]').click();
    await page.locator('.player').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.dataset.mediaId === 'live:5441');
    assert.deepEqual(errors, []);
    reports.push({ viewport, rendered: true, confirmsLiveIdentity: true, returnFocus: true });
  } finally { await session.close(); }
}
await writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports, null, 2));
