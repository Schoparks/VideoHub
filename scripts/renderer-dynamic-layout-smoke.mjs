import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-dynamic-layout');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const dimensions = () => page.locator('main .media-card .cover').first().evaluate(node => ({
  width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
}));
const navigate = label => page.getByRole('button', { name: label, exact: true }).click();
const dynamic = async () => {
  await navigate('哔哩哔哩');
  await navigate('关注动态');
  await page.locator('.dynamic-video-entry .media-card').first().waitFor();
};
const layout = async (tv, columns) => {
  await navigate('设置');
  const switchTv = page.getByRole('switch', { name: '电视模式', exact: true });
  if (await switchTv.getAttribute('aria-checked') !== String(tv)) await switchTv.click();
  await page.getByRole('combobox', { name: '卡片大小', exact: true }).selectOption(String(columns));
  await navigate('关闭弹窗');
};

try {
  await page.evaluate(() => {
    window.hub.browse = async request => {
      const items = Array.from({ length: 12 }, (_, index) => ({ id: `bili:layout:${index}`, source: 'bilibili', kind: 'video',
        title: `动态尺寸视频 ${index + 1}`, author: '同一作者', aid: index + 1, duration: 180 }));
      if (request.kind !== 'dynamic') return { items, hasMore: false };
      const entries = items.map((video, index) => ({ id: `dynamic:${index}`, video, author: '同一作者',
        publishedAt: 1700000000000, text: index === 0 ? '完整动态正文 '.repeat(160) + '正文结尾' : '', images: [], url: '' }));
      if (request.dynamicType !== 'video') entries.splice(2, 0, {
        id: 'dynamic:text', author: '文字作者', text: '文字动态仍完整保留', images: [], url: '',
      });
      return { items: [], dynamics: entries, hasMore: false };
    };
  });
  await navigate('重试');
  await page.locator('.media-card').first().waitFor();
  await connectPad(page);
  for (const [tv, viewport] of [[false, { width: 1440, height: 950 }], [true, { width: 1920, height: 1080 }]]) {
    await page.setViewportSize(viewport);
    for (const columns of [0, 2, 3, 4, 5, 6]) {
      await layout(tv, columns);
      await navigate('首页');
      const home = await dimensions();
      await dynamic();
      const feed = await dimensions();
      assert.ok(Math.abs(feed.width - home.width) < 1, `${tv}/${columns}: card width differs`);
      assert.ok(Math.abs(feed.height - home.height) < 1, `${tv}/${columns}: cover height differs`);
      assert.ok(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth));
      assert.equal(await page.locator('.dynamic-video-entry[tabindex]').count(), 0);
    }
    checks.push(`${tv ? 'TV' : 'desktop'} dynamic video cards match home dimensions in automatic and 2–6 column layouts`);
  }
  await page.getByRole('group', { name: '动态筛选', exact: true }).getByRole('button', { name: '视频', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.dynamic-video-entry').length === 12);
  await page.locator('.dynamic-video-entry .media-card').first().focus();
  await pressPad(page, 0);
  await page.waitForFunction(() => !!document.querySelector('video') && !document.querySelector('video').paused);
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放 动态尺寸视频 1');
  checks.push('direct video focus confirms playback and explicit exit restores the same card');
  const caption = page.locator('.dynamic-video-text').first();
  assert.ok((await caption.innerText()).endsWith('正文结尾'));
  assert.ok(await caption.evaluate(node => node.scrollHeight > node.clientHeight));
  await caption.focus();
  await pressPad(page, 13, 400);
  assert.ok(await caption.evaluate(node => node.scrollTop > 0));
  await page.getByRole('group', { name: '动态筛选', exact: true }).getByRole('button', { name: '全部', exact: true }).click();
  assert.equal(await page.getByText('文字动态仍完整保留', { exact: true }).count(), 1);
  await page.screenshot({ path: resolve(output, 'television.png'), animations: 'disabled' });
  checks.push('long video captions remain fully scrollable and non-video dynamic content stays available');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
