import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

const output = resolve('.tmp/renderer-artwork');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const requests = [];
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jipkAAAAASUVORK5CYII=', 'base64');
  try {
    await page.route('https://i0.hdslb.com/**', route => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: 'image/png', body: pixel });
    });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    if (tv) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('switch', { name: '电视模式', exact: true }).click();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    // API remains bound to the isolated fixture. Exercise HTTPS artwork presentation;
    // actual desktop protocol and CDN decoding are checked by hidden account tests.
    await page.evaluate(() => {
      const api = window.hub;
      window.hub = undefined;
      window.reliability.boot.account.avatar = 'https://i0.hdslb.com/avatar.jpg';
      const item = { ...window.reliability.boot.queue[0], cover: 'https://i0.hdslb.com/cover.jpg' };
      api.browse = async request => request.kind === 'dynamic'
        ? { items: [], hasMore: false, dynamics: [{ id: 'dynamic:artwork', video: item,
          author: '测试作者', avatar: 'https://i0.hdslb.com/author.png', text: '',
          images: ['https://i0.hdslb.com/photo.jpg'], url: '' }] }
        : { items: [item], hasMore: false };
    });
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.locator('.player').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.profile img')?.complete);
    assert.ok(await page.locator('.profile img').getAttribute('src').then(src => src.includes('@160w_160h.webp')));
    await page.getByRole('button', { name: '哔哩哔哩', exact: true }).click();
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    const cover = page.locator('.media-card .cover img').first();
    await page.waitForFunction(() => document.querySelector('.media-card .cover img')?.naturalWidth > 0);
    assert.ok((await cover.getAttribute('src')).includes('@960w_960h.webp'));
    assert.equal(await cover.getAttribute('decoding'), 'async');
    checks.push(`${mode}: account avatar and video covers request separate sizes with asynchronous decoding`);

    await page.getByRole('button', { name: '关注动态', exact: true }).click();
    const photo = page.getByAltText('动态配图 1', { exact: true });
    await photo.waitFor();
    assert.ok((await photo.getAttribute('src')).includes('@1440w_1440h.webp'));
    assert.ok((await page.locator('.dynamic-avatar img').getAttribute('src')).includes('@160w_160h.webp'));
    assert.equal(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    checks.push(`${mode}: dynamic photos retain larger thumbnails; author avatars stay small without changing layout`);
    assert.ok(requests.some(address => address.includes('@960w_960h.webp')));
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, fixtureImages: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
