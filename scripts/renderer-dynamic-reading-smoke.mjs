import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-dynamic-reading');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  try {
    await page.evaluate(() => {
      window.hub.browse = async request => request.kind === 'dynamic' ? {
        items: [], hasMore: false, dynamics: Array.from({ length: 24 }, (_, index) => ({
          id: `reading:${index}`, author: `作者 ${index + 1}`, images: [], url: '',
          text: index === 0 ? '完整正文逐段阅读。\n'.repeat(180) + '正文最后一段' : `短动态 ${index + 1}`,
          original: index === 1 ? {
            id: 'original:video', author: '原作者', text: '转发正文 '.repeat(180), images: [], url: '',
            video: { ...window.reliability.boot.queue[0], title: '转发视频' },
          } : undefined,
        })),
      } : { items: [window.reliability.boot.queue[0]], hasMore: false };
    });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    if (tv) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('switch', { name: '电视模式', exact: true }).click();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    await page.getByRole('button', { name: '哔哩哔哩', exact: true }).click();
    await page.getByRole('button', { name: '关注动态', exact: true }).click();
    const article = page.locator('main .dynamic-entry').first();
    await article.waitFor();
    await connectPad(page);
    await article.focus();
    const dimensions = await article.evaluate(node => ({
      height: node.getBoundingClientRect().height,
      viewport: document.querySelector('main').clientHeight,
      content: node.scrollHeight,
      client: node.clientHeight,
    }));
    assert.ok(dimensions.height < dimensions.viewport, 'long dynamic must fit the reading viewport');
    assert.ok(dimensions.content > dimensions.client * 2);
    await pressPad(page, 13);
    assert.ok(await article.evaluate(node => node.scrollTop > 0 && node === document.activeElement));
    await pressPad(page, 12);
    assert.equal(await article.evaluate(node => node.scrollTop), 0);
    checks.push(`${mode}: long text fits the viewport and controller directions scroll while retaining its focus`);
    await page.keyboard.press('ArrowDown');
    assert.ok(await article.evaluate(node => node.scrollTop > 0 && node === document.activeElement));
    await article.evaluate(node => { node.scrollTop = node.scrollHeight; });
    assert.ok((await article.innerText()).endsWith('正文最后一段'));
    assert.ok(await article.evaluate(node => {
      const range = document.createRange();
      const text = node.querySelector('.dynamic-text').lastChild;
      range.selectNodeContents(text);
      range.setStart(text, Math.max(0, text.length - 7));
      const tail = range.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return tail.bottom <= rect.bottom && tail.top >= rect.top;
    }));
    await page.screenshot({ path: resolve(output, `${mode}.png`) });
    await pressPad(page, 13);
    assert.equal(await article.evaluate(node => node === document.activeElement), false);
    checks.push(`${mode}: native keyboard reads the same complete content and Down leaves at its bottom boundary`);
    await article.focus();
    await article.evaluate(node => { node.scrollTop = 0; });
    await pressPad(page, 12);
    assert.equal(await article.evaluate(node => node === document.activeElement), false);
    checks.push(`${mode}: Up leaves at the top boundary instead of trapping the reader`);
    await article.focus();
    const beforePage = await page.locator('main').evaluate(node => node.scrollTop);
    await pressPad(page, 7);
    assert.notEqual(await article.evaluate(node => node === document.activeElement), true);
    assert.ok(await page.locator('main').evaluate(node => node.scrollTop) > beforePage);
    checks.push(`${mode}: RT still pages the outer list without scrolling or editing the article`);
    assert.ok(await page.locator('.dynamic-entry').nth(2).evaluate(node => node.scrollHeight <= node.clientHeight));
    const repost = page.locator('.dynamic-entry').nth(1);
    const video = repost.locator('.media-card');
    await video.focus();
    assert.ok(await video.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const parent = node.closest('.dynamic-entry').getBoundingClientRect();
      return rect.top >= parent.top + 11 && rect.bottom <= parent.bottom - 11;
    }), 'nested playable card keeps its complete focus outline inside the scrollable repost');
    await pressPad(page, 0);
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('video')
      && document.activeElement?.getAttribute('aria-label') === '播放 转发视频');
    checks.push(`${mode}: short entries stay compact and reposted videos remain fully focusable, playable and returnable`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
