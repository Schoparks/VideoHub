import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-browse-hierarchy');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const focused = locator => locator.evaluate(node => document.activeElement === node);
  const button = name => page.getByRole('button', { name, exact: true });
  const cards = () => page.locator('main .media-card');
  const remote = action => page.evaluate(action => window.dispatchEvent(new CustomEvent('hub-remote', { detail: action })), action);
  try {
    await page.evaluate(tv => {
      const state = window.hierarchy = { requests: [], films: false, held: [] };
      window.reliability.boot.preferences.tvMode = tv;
      window.hub.browse = async request => {
        state.requests.push(structuredClone(request));
        if (request.keyword === '等待结果') await new Promise(resolve => state.held.push(resolve));
        if (request.searchType === 'media_ft') return {
          items: state.films ? [{ id: 'season:210727', source: 'bilibili', kind: 'season',
            seasonId: 210727, title: '黑袍纠察队 第一季' }] : [], hasMore: false,
        };
        return { items: Array.from({ length: 96 }, (_, index) => ({
          ...window.reliability.boot.queue[0], id: `video:${index}`, title: `列表 ${index + 1}`,
        })), hasMore: false };
      };
    }, tv);
    await button('重试').click();
    await cards().first().waitFor();
    await connectPad(page);

    await button('设置').focus();
    await pressPad(page, 15);
    const search = page.getByRole('textbox', { name: '搜索视频', exact: true });
    assert.equal(await focused(search), true);
    await pressPad(page, 15);
    assert.equal(await focused(button('手柄屏幕键盘')), true);
    await pressPad(page, 15);
    assert.equal(await focused(button('切换电视模式')), true);
    await pressPad(page, 15);
    assert.equal(await focused(button('管理 B 站账号')), true);
    for (let index = 0; index < 4; index++) await pressPad(page, 14);
    assert.equal(await focused(button('设置')), true);
    await pressPad(page, 15);
    await pressPad(page, 0);
    await page.locator('.screen-keyboard').waitFor();
    await pressPad(page, 1);
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await button('我的收藏').focus();
    await pressPad(page, 5);
    assert.equal(await focused(button('设置')), true);
    await pressPad(page, 5);
    assert.equal(await focused(search), true);
    assert.equal(await page.getByRole('dialog').count(), 0);
    checks.push(`${mode}: full header crosses search, screen keyboard, TV and account controls in both directions`);

    await button('哔哩哔哩').click();
    await button('分区浏览').click();
    await cards().first().waitFor();
    await cards().first().focus();
    await pressPad(page, 1);
    assert.equal(await focused(button('游戏')), true);
    await pressPad(page, 1);
    assert.equal(await focused(button('分区浏览')), true);
    await pressPad(page, 1);
    assert.equal(await focused(button('哔哩哔哩')), true);
    await pressPad(page, 13);
    assert.equal(await focused(button('分区浏览')), true);
    await pressPad(page, 13);
    assert.equal(await focused(button('游戏')), true);
    await pressPad(page, 13);
    assert.equal(await focused(cards().first()), true);
    checks.push(`${mode}: B ascends filters/tabs/main navigation one level; down enters the same levels`);

    await cards().nth(70).focus();
    let count = 0;
    while (await page.locator('main').evaluate(node => node.scrollTop > 1)) {
      await pressPad(page, 12);
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('main')), true);
      if (++count > 45) throw new Error('up did not reach the content top');
    }
    assert.ok(count > 0);
    await button('游戏').focus();
    await page.locator('main').evaluate(node => { node.scrollTop = 30; });
    await remote('up');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('main')), true);
    await cards().first().focus();
    await page.locator('main').evaluate(node => { node.scrollTop = 0; });
    await remote('up');
    assert.equal(await focused(button('游戏')), true);
    await remote('back');
    assert.equal(await focused(button('分区浏览')), true);
    await remote('back');
    assert.equal(await focused(button('哔哩哔哩')), true);
    checks.push(`${mode}: up scrolls deep content without jumping to fixed header; remote return shares hierarchy`);

    await cards().first().focus();
    await pressPad(page, 5);
    assert.equal(await focused(button('知识')), true);
    assert.equal(await button('知识').getAttribute('aria-pressed'), 'true');
    await button('影视').click();
    await pressPad(page, 5);
    assert.equal(await focused(button('关注直播')), true);
    assert.equal(await page.locator('main').getAttribute('aria-label'), '关注直播');
    await button('哔哩哔哩').click();
    await button('分区浏览').click();
    await button('游戏').click();
    await cards().first().focus();
    await pressPad(page, 4);
    assert.equal(await focused(button('关注动态')), true);
    assert.equal(await button('关注动态').getAttribute('aria-pressed'), 'true');
    await pressPad(page, 4);
    assert.equal(await focused(button('App 推荐')), true);
    await pressPad(page, 4);
    assert.equal(await focused(button('首页')), true);
    checks.push(`${mode}: shoulders traverse category/filter siblings and ascend at their edges without cycling`);

    await search.fill('黑袍纠察队');
    await search.press('Enter');
    await cards().first().waitFor();
    await button('影视').click();
    await page.getByText('暂无内容', { exact: true }).waitFor();
    await page.evaluate(() => { window.hierarchy.films = true; });
    const before = await page.evaluate(() => window.hierarchy.requests.filter(request => request.searchType === 'media_ft').length);
    await button('刷新').click();
    await page.getByRole('button', { name: '播放 黑袍纠察队 第一季', exact: true }).waitFor();
    const after = await page.evaluate(() => window.hierarchy.requests.filter(request => request.searchType === 'media_ft').length);
    assert.equal(after, before + 1);
    assert.equal(await button('影视').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.hierarchy.requests.at(-1).keyword), '黑袍纠察队');
    await page.screenshot({ path: resolve(output, `${mode}-films.png`) });
    await cards().first().focus();
    await pressPad(page, 1);
    assert.equal(await focused(button('影视')), true);
    await pressPad(page, 1);
    assert.equal(await focused(button('首页')), true);
    checks.push(`${mode}: search refresh re-requests the current film filter after a cached empty response`);

    await button('全部').click();
    await search.fill('等待结果');
    await search.press('Enter');
    await page.waitForFunction(() => window.hierarchy.held.length > 0);
    await button('全部').focus();
    await pressPad(page, 5);
    assert.equal(await focused(button('视频')), true);
    await page.waitForFunction(() => window.hierarchy.held.length === 2);
    await page.evaluate(() => window.hierarchy.held.splice(0).forEach(resolve => resolve()));
    await cards().first().waitFor();
    await page.waitForTimeout(120);
    assert.equal(await focused(button('视频')), true);
    checks.push(`${mode}: late results cannot override a newer shoulder selection`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, simulatedInput: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
