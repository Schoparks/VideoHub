import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { launchPaginationHarness } from './pagination-harness.mjs';

const output = resolve('.tmp/browse-pagination-smoke');
await mkdir(output, { recursive: true });
await readFile('dist/index.html');
await readFile('dist-electron/main.cjs');
const { page, profile, evaluate, install, close } = await launchPaginationHarness(output);
const errors = [];
const checks = [];
try {
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
  const boot = await page.evaluate(() => window.hub.bootstrap());
  await install(boot);
  await page.reload();
  const button = name => page.getByRole('button', { name, exact: true });
  const state = () => evaluate(() => ({
    browse: globalThis.paginationSmoke.browse,
    maxActive: globalThis.paginationSmoke.maxActive,
    active: globalThis.paginationSmoke.active,
    resolves: globalThis.paginationSmoke.resolves,
    releases: globalThis.paginationSmoke.releases,
  }));
  const requests = async key => (await state()).browse.filter(request => request.key === key);
  const scroll = position => page.locator('main').evaluate((main, position) => {
    main.scrollTop = position === 'bottom' ? main.scrollHeight : 0;
    main.dispatchEvent(new Event('scroll'));
  }, position);
  const settle = async (count, dynamic = false) => {
    await page.waitForFunction(({ count, dynamic }) => {
      const selector = dynamic ? '.dynamic-entry' : '.feed-results .media-card';
      return document.querySelectorAll(selector).length === count
        && document.querySelector('.feed-results')?.getAttribute('aria-busy') === 'false';
    }, { count, dynamic });
  };
  const search = async keyword => {
    await scroll('top');
    await page.getByRole('textbox', { name: '搜索视频', exact: true }).fill(keyword);
    await page.getByRole('textbox', { name: '搜索视频', exact: true }).press('Enter');
    await page.getByRole('heading', { name: `搜索：${keyword}`, exact: true }).waitFor();
    await page.waitForFunction(keyword => {
      const feed = document.querySelector('.feed-results');
      const card = feed?.querySelector('.media-card');
      return feed?.getAttribute('aria-busy') === 'false'
        && (keyword === 'empty' ? !card : card?.dataset.mediaId?.startsWith(`search:${keyword}:`));
    }, keyword);
  };
  const assertPagination = async (key, dynamic = false) => {
    await settle(40, dynamic);
    await page.waitForTimeout(200);
    assert.equal((await requests(key)).length, 1, `${key} should wait outside the prefetch zone`);
    assert.equal(await button('加载更多').count(), 0);
    await scroll('bottom');
    await settle(60, dynamic);
    await scroll('bottom');
    await page.waitForTimeout(350);
    const calls = await requests(key);
    assert.deepEqual(calls.map(call => call.page), [1, 2], `${key} stops at the final page`);
    assert.deepEqual(calls.map(call => call.cursor), [undefined, `${key}:cursor-1`]);
    const ids = await page.locator(dynamic ? '.dynamic-entry' : '.feed-results .media-card')
      .evaluateAll(nodes => nodes.map(node => node.dataset.mediaId || node.textContent));
    assert.equal(new Set(ids).size, 60, `${key} removes the overlapping boundary item`);
    await scroll('top');
  };

  await button('哔哩哔哩').click();
  await button('关注动态').click();
  await assertPagination('dynamic:all', true);
  await button('视频').click();
  await assertPagination('dynamic:video', true);
  await button('全部').click();
  await settle(60, true);
  assert.equal((await requests('dynamic:all')).length, 2);
  await button('分区浏览').click();
  await assertPagination('regions:4');
  await button('知识').click();
  await assertPagination('regions:36');
  await button('游戏').click();
  await settle(60);
  assert.equal((await requests('regions:4')).length, 2);
  checks.push('dynamic all/video and regional filters load on scroll and keep independent caches');

  await button('关注直播').click();
  assert.equal(await button('直播广场').count(), 0);
  await assertPagination('followingLive:');
  await button('番剧与影视').click();
  await assertPagination('cinema:2');
  await button('番剧').click();
  await assertPagination('cinema:1');
  await button('我的追番追剧').click();
  await assertPagination('followingCinema:1');
  await button('追剧').click();
  await assertPagination('followingCinema:2');
  checks.push('followed live, cinema categories and followed seasons use automatic page/cursor pagination');

  await button('我的收藏').click();
  await assertPagination('watchlater:');
  await button('B 站历史').click();
  await assertPagination('history:');
  await button('B 站收藏').click();
  await page.getByRole('button', { name: /^收藏夹一/ }).waitFor();
  await assertPagination('favorites:1');
  await page.getByRole('button', { name: /^收藏夹二/ }).click();
  await assertPagination('favorites:2');
  await page.getByRole('button', { name: /^收藏夹一/ }).click();
  await settle(60);
  assert.equal((await requests('favorites:1')).length, 2);
  await search('normal');
  await assertPagination('search:normal');
  checks.push('history, watch later, independent favorite folders and search load automatically and stop at hasMore=false');

  const searchTypes = page.getByRole('group', { name: '搜索类型', exact: true });
  for (const [label, type] of [['视频', 'video'], ['番剧', 'media_bangumi'], ['影视', 'media_ft'], ['直播', 'live_room']]) {
    await searchTypes.getByRole('button', { name: label, exact: true }).click();
    await assertPagination(`search:normal:${type}`);
  }
  await searchTypes.getByRole('button', { name: '影视', exact: true }).click();
  await settle(60);
  await page.locator('.feed-results .media-card').first().click();
  await page.locator('.player').waitFor();
  const playedSeason = (await state()).resolves.at(-1);
  assert.equal(playedSeason.kind, 'season');
  assert.equal(playedSeason.seasonId, 900001);
  assert.equal(playedSeason.episodeId, 800001);
  await button('退出播放').click();
  await page.locator('.player').waitFor({ state: 'hidden' });
  await searchTypes.getByRole('button', { name: '全部', exact: true }).click();
  await settle(60);
  assert.equal((await requests('search:normal')).length, 2);
  await searchTypes.getByRole('button', { name: '番剧', exact: true }).click();
  await settle(60);
  assert.equal((await requests('search:normal:media_bangumi')).length, 2);
  await searchTypes.getByRole('button', { name: '全部', exact: true }).click();
  checks.push('all/video/bangumi/film/live search types retain independent pagination and cached results; season cards dispatch playable identities');

  await search('error');
  await settle(40);
  await scroll('bottom');
  await page.getByRole('alert').filter({ hasText: '下一页暂时无法加载' }).waitFor();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.feed-results .media-card').count(), 40);
  assert.equal((await requests('search:error')).length, 2, 'failure must not retry automatically');
  await button('重试').click();
  await settle(60);
  const retries = await requests('search:error');
  assert.deepEqual(retries.map(call => call.page), [1, 2, 2]);
  assert.deepEqual(retries.map(call => call.cursor), [undefined, 'search:error:cursor-1', 'search:error:cursor-1']);
  assert.equal(await page.getByRole('alert').count(), 0);
  checks.push('failed append retains existing items and retries the same failed page and cursor');

  for (const mode of ['empty', 'duplicate', 'loop']) {
    await search(mode);
    if (mode !== 'empty') {
      await settle(40);
      await scroll('bottom');
    }
    await page.waitForTimeout(1800);
    const before = await requests(`search:${mode}`);
    assert.ok(before.length >= 2 && before.length <= 6, `${mode} must stop after bounded attempts`);
    await scroll('bottom');
    await page.waitForTimeout(450);
    assert.equal((await requests(`search:${mode}`)).length, before.length);
    assert.equal(await page.locator('.feed-results .media-card').count(), mode === 'empty' ? 0 : 40);
  }
  checks.push('empty, duplicate and unchanged-cursor pages terminate without infinite automatic requests');

  await search('suspended');
  await settle(40);
  await button('打开链接').click();
  await page.getByRole('dialog').waitFor();
  await scroll('bottom');
  await page.waitForTimeout(350);
  assert.equal((await requests('search:suspended')).length, 1);
  await scroll('top');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await scroll('bottom');
  await page.waitForTimeout(350);
  assert.equal((await requests('search:suspended')).length, 1);
  await scroll('top');
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await evaluate(() => { globalThis.paginationSmoke.deferResolve = true; });
  await page.locator('.feed-results .media-card').first().click();
  await page.locator('.working-pill').waitFor();
  await scroll('bottom');
  await page.waitForTimeout(350);
  assert.equal((await requests('search:suspended')).length, 1);
  await evaluate(() => { globalThis.paginationSmoke.finishResolve(); });
  await page.locator('.player').waitFor();
  await scroll('bottom');
  await page.waitForTimeout(350);
  assert.equal((await requests('search:suspended')).length, 1);
  await scroll('top');
  await button('退出播放').click();
  await page.locator('.player').waitFor({ state: 'hidden' });
  await settle(40);
  await button('本地片库').click();
  await scroll('bottom');
  await page.waitForTimeout(350);
  assert.equal((await requests('search:suspended')).length, 1);
  await search('suspended');
  await settle(40);
  await scroll('bottom');
  await settle(60);
  assert.equal((await requests('search:suspended')).length, 2);
  checks.push('dialogs, hidden documents, pending playback, player overlays and inactive routes suspend prefetch; returning resumes cached feeds');

  const historyBefore = (await requests('history:')).length;
  await evaluate(() => { globalThis.paginationSmoke.historyLoop = true; });
  await page.reload();
  await button('我的收藏').click();
  await settle(40);
  await button('B 站历史').click();
  await settle(40);
  await scroll('bottom');
  await page.waitForTimeout(600);
  assert.equal((await requests('history:')).length - historyBefore, 2,
    'history uses cursor pagination and must stop immediately when its cursor repeats');
  await scroll('bottom');
  await page.waitForTimeout(350);
  assert.equal((await requests('history:')).length - historyBefore, 2);
  checks.push('repeated history cursor terminates immediately without hiding previously loaded items');

  const snapshot = await state();
  assert.equal(snapshot.maxActive, 1, 'automatic requests must remain serial');
  assert.deepEqual(snapshot.releases, ['pagination-playback-1', 'pagination-playback-2']);
  assert.deepEqual(errors, []);
  const result = {
    result: 'passed',
    profile,
    requestCount: snapshot.browse.length,
    maxConcurrentRequests: snapshot.maxActive,
    checks,
    errors,
  };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    console.error(JSON.stringify(await stateOnFailure()));
    await page.screenshot({ path: resolve(output, 'failure.png'), timeout: 3000 }).catch(() => {});
  }
  throw error;
} finally {
  await close();
}

async function stateOnFailure() {
  return evaluate(() => ({
    recentRequests: globalThis.paginationSmoke?.browse.slice(-12),
    active: globalThis.paginationSmoke?.active,
  })).catch(() => ({}));
}
