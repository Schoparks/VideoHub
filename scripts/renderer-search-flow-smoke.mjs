import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-search-flow');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];
const input = page.getByRole('textbox', { name: '搜索视频', exact: true });
const focused = locator => locator.evaluate(node => document.activeElement === node);
const cards = () => page.locator('main .media-card');
const search = async keyword => {
  await input.fill(keyword);
  await input.press('Enter');
  await page.getByRole('heading', { name: `搜索：${keyword}`, exact: true }).waitFor();
};
const waiting = () => page.waitForFunction(() => window.searchFlow.pending.length > 0);
const finish = keyword => page.evaluate(keyword => {
  const pending = window.searchFlow.pending;
  const index = keyword ? pending.findIndex(entry => entry.request.keyword === keyword) : 0;
  assertIndex(index);
  pending.splice(index, 1)[0].finish();
  function assertIndex(index) { if (index < 0) throw new Error('No matching pending request'); }
}, keyword);
const hold = value => page.evaluate(value => { window.searchFlow.hold = value; }, value);
const firstFocused = keyword => page.waitForFunction(keyword =>
  document.activeElement?.matches('.media-card')
    && document.activeElement?.getAttribute('aria-label') === `播放 ${keyword} 1`, keyword);

try {
  await page.evaluate(() => {
    const state = window.searchFlow = { requests: [], pending: [], hold: false, fail: false };
    window.hub.browse = async request => {
      state.requests.push(structuredClone(request));
      const fail = state.fail;
      state.fail = false;
      if (state.hold) await new Promise(finish => state.pending.push({ request, finish }));
      if (fail) throw new Error('列表读取失败');
      return {
        items: request.keyword === '没有结果' ? [] : Array.from({ length: 16 }, (_, index) => ({
          id: `${request.kind}:${request.keyword}:${request.searchType}:${index}`,
          source: 'bilibili', kind: 'video',
          title: `${request.kind === 'search' ? request.keyword : request.kind} ${index + 1}`, aid: index + 1,
        })), hasMore: false,
      };
    };
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await cards().first().waitFor();
  await connectPad(page);

  await search('电影甲');
  await firstFocused('电影甲');
  await search('电影乙');
  await firstFocused('电影乙');
  const beforeRepeat = await page.evaluate(() => window.searchFlow.requests.length);
  await search('电影乙');
  await firstFocused('电影乙');
  assert.equal(await page.evaluate(() => window.searchFlow.requests.length), beforeRepeat);
  checks.push('native submissions on the same search page focus the current results, including a cached repeated query');

  const videos = page.getByRole('button', { name: '视频', exact: true });
  await videos.click();
  await page.waitForFunction(() => window.searchFlow.requests.at(-1).searchType === 'video');
  await search('电影乙');
  await firstFocused('电影乙');
  assert.equal(await page.evaluate(() => window.searchFlow.requests.at(-1).searchType), 'video');
  await search('电影丙');
  await firstFocused('电影丙');
  assert.equal(await page.evaluate(() => window.searchFlow.requests.at(-1).searchType), 'all');
  assert.equal(await page.getByRole('button', { name: '全部', exact: true }).getAttribute('aria-pressed'), 'true');
  checks.push('a new keyword searches all media categories after a previous video-only filter; repeating a keyword keeps its filter');

  await hold(true);
  await search('等待结果');
  await waiting();
  assert.equal(await focused(input), true, JSON.stringify(await page.evaluate(() => ({
    active: document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,
    cards: document.querySelectorAll('.media-card').length,
    busy: document.querySelector('.feed-results')?.getAttribute('aria-busy'),
  }))));
  await hold(false);
  await finish('等待结果');
  await firstFocused('等待结果');
  checks.push('a same-page submission waits for its new response instead of focusing the previous keyword');

  await hold(true);
  await search('先到请求');
  await waiting();
  await search('最新请求');
  await page.waitForFunction(() => window.searchFlow.pending.length === 2);
  await finish('先到请求');
  await page.waitForTimeout(100);
  assert.equal(await cards().count(), 0);
  await hold(false);
  await finish('最新请求');
  await firstFocused('最新请求');
  checks.push('a late response from an earlier search cannot replace or focus results of the newest query');

  await hold(true);
  await search('自行移动');
  await waiting();
  const home = page.getByRole('button', { name: '首页', exact: true });
  await home.focus();
  await pressPad(page, 13);
  const destination = page.getByRole('button', { name: '全部', exact: true });
  assert.equal(await focused(destination), true);
  await hold(false);
  await finish('自行移动');
  await cards().first().waitFor();
  await page.waitForTimeout(150);
  assert.equal(await focused(destination), true);
  checks.push('delayed search results do not steal focus after a deliberate controller movement');

  await search('没有结果');
  const all = page.getByRole('button', { name: '全部', exact: true });
  await page.getByText('暂无内容', { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-pressed') === 'true'
    && document.activeElement?.closest('.chips'));
  assert.equal(await focused(all), true);
  assert.equal(await focused(page.getByRole('button', { name: '打开链接', exact: true })), false);
  checks.push('an empty search keeps a useful result filter focused instead of unrelated file/link actions');

  await page.evaluate(() => { window.searchFlow.fail = true; });
  await search('失败重试');
  const retry = page.getByRole('button', { name: '重试', exact: true });
  await page.getByText('列表读取失败', { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === '重试');
  await hold(true);
  await page.evaluate(() => { window.searchFlow.fail = true; });
  await pressPad(page, 0);
  await waiting();
  assert.equal(await focused(retry), true);
  assert.equal(await retry.getAttribute('aria-disabled'), 'true');
  const retryRequests = await page.evaluate(() => window.searchFlow.requests.length);
  await pressPad(page, 0);
  assert.equal(await page.evaluate(() => window.searchFlow.requests.length), retryRequests);
  await hold(false);
  await finish('失败重试');
  await page.waitForFunction(() => document.querySelector('.feed-results')?.getAttribute('aria-busy') === 'false');
  assert.equal(await focused(retry), true);
  assert.equal(await retry.getAttribute('aria-disabled'), 'false');
  await hold(true);
  await pressPad(page, 0);
  await waiting();
  assert.equal(await focused(retry), true);
  await hold(false);
  await finish('失败重试');
  await firstFocused('失败重试');
  assert.equal(await retry.count(), 0);
  checks.push('failed search retry retains focus, blocks duplicate confirmation and focuses recovered results');

  await home.click();
  await cards().first().waitFor();
  const refresh = page.getByRole('button', { name: '换一批', exact: true });
  await refresh.focus();
  await hold(true);
  await pressPad(page, 0);
  await waiting();
  assert.equal(await focused(refresh), true);
  const refreshRequests = await page.evaluate(() => window.searchFlow.requests.length);
  await pressPad(page, 0);
  assert.equal(await page.evaluate(() => window.searchFlow.requests.length), refreshRequests);
  await hold(false);
  await finish();
  await page.waitForFunction(() => document.querySelector('.feed-results')?.getAttribute('aria-busy') === 'false');
  assert.equal(await focused(refresh), true);
  checks.push('recommendation refresh retains its initiating focus while awaiting a response and rejects duplicate confirmation');

  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.evaluate(() => { window.reliability.foldersMode = 'error'; });
  await page.getByRole('button', { name: 'B 站收藏', exact: true }).click();
  await page.getByText('收藏夹读取失败', { exact: true }).waitFor();
  await retry.focus();
  await page.evaluate(() => { window.reliability.foldersMode = 'loading'; });
  await pressPad(page, 0);
  await page.waitForFunction(() => !!window.reliability.finishFolders);
  assert.equal(await focused(retry), true);
  assert.equal(await retry.getAttribute('aria-disabled'), 'true');
  const folderCalls = await page.evaluate(() => window.reliability.foldersCalls);
  await pressPad(page, 0);
  assert.equal(await page.evaluate(() => window.reliability.foldersCalls), folderCalls);
  await page.evaluate(() => { window.reliability.foldersMode = 'normal'; window.reliability.finishFolders(); });
  await firstFocused('favorites');
  checks.push('folder-list retry keeps its control while loading and restores focus into the recovered collection');

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('button', { name: '切换电视模式', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.tv === 'true');
  await search('电视搜索');
  await firstFocused('电视搜索');
  assert.ok(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth));
  await page.screenshot({ path: resolve(output, 'television.png'), animations: 'disabled' });
  checks.push('the same flow works in the television layout without horizontal overflow');
  assert.deepEqual(errors, []);
  const result = { checks, errors };
  await writeFile(resolve(output, 'checks.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await close(); }
