import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-collection-pages');
await mkdir(output, { recursive: true });
const session = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const { page, errors } = session;
const checks = [];
const press = index => pressPad(page, index, 80);
const focus = locator => locator.evaluate(button => { button.scrollIntoView({ block: 'nearest' }); button.focus(); });
try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.evaluate(() => {
    const base = window.reliability.boot.queue[0];
    const state = window.collectionPages = {
      items: Array.from({ length: 12 }, (_, index) => ({ ...base, id: `collection:${index + 1}`, title: `收藏视频 ${index + 1}` })),
      calls: [], holdSecond: false, failThird: false, refreshing: false,
    };
    const browse = window.hub.browse;
    window.hub.browse = async request => {
      if (request.kind !== 'favorites') return browse(request);
      state.calls.push({ page: request.page, refresh: !!request.refresh });
      if (request.page === 1) state.refreshing = !!request.refresh;
      const result = { items: structuredClone(state.items.slice((request.page - 1) * 2, request.page * 2)), hasMore: request.page * 2 < state.items.length };
      if (state.refreshing && request.page === 2 && state.holdSecond) await new Promise(resolve => { state.finish = resolve; });
      if (state.refreshing && request.page === 3 && state.failThird) throw new Error('收藏第三页刷新失败');
      return result;
    };
    window.hub.folders = async () => [{ id: 1, title: '测试收藏夹', count: state.items.length }];
    window.hub.favorite = async (item, _folder, add) => {
      if (add) throw new Error('测试只移除夹具条目');
      state.items = state.items.filter(existing => existing.id !== item.id);
    };
  });
  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.getByRole('button', { name: 'B 站收藏', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 12);
  assert.deepEqual(await page.evaluate(() => window.collectionPages.calls.map(call => call.page)), [1, 2, 3, 4, 5, 6]);
  checks.push('six collection pages load serially into the browsing list');
  await connectPad(page);
  await page.waitForTimeout(200);
  const remove = async index => {
    await focus(page.getByRole('button', { name: `播放 收藏视频 ${index}`, exact: true }));
    await press(2);
    await focus(page.getByRole('button', { name: '收藏', exact: true }));
    await press(0);
    await page.getByRole('combobox', { name: 'B 站收藏夹', exact: true }).waitFor();
    await focus(page.getByRole('button', { name: '取消此收藏', exact: true }));
    await press(0);
    await page.waitForFunction(() => !document.querySelector('.favorite-panel'));
    await press(1);
  };
  await page.evaluate(() => { window.collectionPages.holdSecond = true; window.collectionPages.failThird = true; });
  await remove(7);
  await page.waitForFunction(() => !!window.collectionPages.finish);
  assert.equal(await page.locator('.media-card').count(), 11);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-media-id')), 'collection:8');
  await page.evaluate(() => { window.collectionPages.holdSecond = false; window.collectionPages.finish(); });
  await page.getByRole('alert').filter({ hasText: '收藏第三页刷新失败' }).waitFor();
  assert.equal(await page.locator('.media-card').count(), 11);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-media-id')), 'collection:8');
  checks.push('refresh stages pages without shrinking the visible prefix; a later-page failure retains all surviving cards and focus');
  await page.evaluate(() => { window.collectionPages.failThird = false; });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alert"], .loading'));
  assert.equal(await page.locator('.media-card').count(), 11);
  assert.deepEqual(await page.evaluate(() => window.collectionPages.calls.slice(-6).map(call => call.page)), [1, 2, 3, 4, 5, 6]);
  checks.push('retry rebuilds the loaded prefix in source order and commits all pages together');

  await page.evaluate(() => { window.collectionPages.holdSecond = true; window.collectionPages.finish = undefined; });
  await remove(9);
  await page.waitForFunction(() => !!window.collectionPages.finish);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.evaluate(() => { window.collectionPages.holdSecond = false; window.collectionPages.finish(); });
  await page.waitForTimeout(150);
  assert.equal(await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /^播放 收藏视频/ }).count(), 0);
  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.getByRole('button', { name: 'B 站收藏', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 10 && !document.querySelector('.loading'));
  assert.deepEqual(await page.evaluate(() => window.collectionPages.calls.slice(-5).map(call => call.page)), [1, 2, 3, 4, 5]);
  checks.push('changing pages cancels the staged refresh; returning finishes only the dirty collection and stops at its new last page');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors, output }, null, 2));
} finally { await session.close(); }
