import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-experience');
await mkdir(output, { recursive: true });
const session = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const { page, errors } = session;
const checks = [];
const firstCard = () => page.locator('main .media-card').first();
const focused = locator => locator.evaluate(node => node === document.activeElement);
const close = () => page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
const nav = label => page.locator('.nav-item').filter({ hasText: label });

try {
  await page.evaluate(() => {
    const state = window.reliability;
    state.boot.library = Array.from({ length: 12 }, (_, index) => ({
      id: `local:${index}`, source: 'local', kind: 'video', title: `本地视频 ${index + 1}`,
    }));
    window.hub.browse = async request => {
      state.browse.push(structuredClone(request));
      if (state.holdBrowse) await new Promise(resolve => { state.finishBrowse = resolve; });
      if (request.kind === 'followingLive' || request.searchType === 'live_room') {
        return { items: [{ id: 'live:42', source: 'bilibili', kind: 'live', roomId: 42,
          title: '测试关注直播', cover: 'https://fixture.invalid/cover.png', badge: '直播中' }], hasMore: false };
      }
      return { items: state.boot.library.map((item, index) => ({ ...item,
        id: `${request.kind}:${index}`, title: `${request.kind}视频 ${index + 1}` })), hasMore: false };
    };
    const preferences = window.hub.preferences;
    window.hub.preferences = async value => {
      if (state.failNextPreferences) {
        state.failNextPreferences = false;
        throw new Error('设置保存失败');
      }
      return preferences(value);
    };
  });
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jipkAAAAASUVORK5CYII=', 'base64');
  await page.route('https://fixture.invalid/cover.png', route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await firstCard().waitFor();
  await connectPad(page);

  await firstCard().focus();
  await pressPad(page, 5);
  await page.waitForFunction(() => document.querySelector('.nav-item.active')?.textContent.includes('哔哩哔哩'));
  assert.equal(await focused(nav('哔哩哔哩')), true);
  assert.equal(await page.locator('.controller-focus-label').count(), 0);
  assert.ok((await page.locator('.controller-actions').innerText()).includes('逐级切栏'));
  await pressPad(page, 4);
  await page.waitForFunction(() => document.querySelector('.nav-item.active')?.textContent.includes('首页'));
  assert.equal(await focused(nav('首页')), true);
  await pressPad(page, 5);
  await page.waitForFunction(() => document.querySelector('.nav-item.active')?.textContent.includes('哔哩哔哩'));
  assert.equal(await focused(nav('哔哩哔哩')), true);
  checks.push('LB/RB from content traverses the nearest navigation row with compact action hints');

  await page.evaluate(() => { window.reliability.holdBrowse = true; window.reliability.finishBrowse = undefined; });
  await pressPad(page, 5);
  await page.waitForFunction(() => !!window.reliability.finishBrowse);
  await page.evaluate(() => { window.reliability.holdBrowse = false; window.reliability.finishBrowse(); });
  await page.waitForFunction(() => document.querySelector('main .media-card')?.getAttribute('data-media-id') === 'live:42');
  assert.equal(await focused(nav('关注直播')), true);
  assert.equal(await firstCard().getAttribute('data-media-id'), 'live:42');
  assert.equal(await page.getByRole('button', { name: '直播广场', exact: true }).count(), 0);
  assert.equal(await firstCard().locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.ok(await page.evaluate(() => window.reliability.browse.every(request => request.kind !== 'live')));
  checks.push('delayed following data preserves its navigation entry; live cover renders and no plaza request occurs');

  await page.evaluate(() => { window.reliability.holdBrowse = true; window.reliability.finishBrowse = undefined; });
  await pressPad(page, 5);
  await page.waitForFunction(() => !!window.reliability.finishBrowse);
  await nav('本地片库').focus();
  await pressPad(page, 15);
  await page.evaluate(() => { window.reliability.holdBrowse = false; window.reliability.finishBrowse(); });
  await page.waitForTimeout(200);
  assert.equal(await focused(nav('我的收藏')), true);
  checks.push('delayed navigation focus is canceled after a deliberate controller movement');

  await nav('关注直播').focus();
  await pressPad(page, 15);
  assert.equal(await focused(nav('番剧与影视')), true);
  await pressPad(page, 0);
  await page.waitForFunction(() => document.querySelector('.nav-item.active')?.textContent.includes('番剧与影视'));
  assert.equal(await focused(nav('番剧与影视')), true);
  await pressPad(page, 5);
  assert.equal(await focused(nav('本地片库')), true);
  checks.push('direction and A keep the navigation position; shoulder switching in navigation remains there');

  await firstCard().focus();
  for (const index of [15, 13, 14, 12, 15]) {
    await pressPad(page, index);
    assert.equal(await page.evaluate(() => document.activeElement?.matches('.card-details')), false);
  }
  await firstCard().focus();
  await pressPad(page, 2);
  await page.getByRole('dialog').waitFor();
  await pressPad(page, 1);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await focused(firstCard()), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.matches('.card-details')), true);
  await pressPad(page, 2);
  await page.getByRole('dialog').waitFor();
  await pressPad(page, 1);
  assert.equal(await focused(firstCard()), true);
  // Native pointer movement re-enables its separate details affordance.
  await page.mouse.move(700, 500);
  await page.locator('main .card-details').first().click();
  await page.getByRole('dialog').waitFor();
  await close();
  checks.push('gamepad skips card menus, X returns to the same card, while keyboard and pointer retain details access');

  for (const tv of [false, true]) {
    await page.setViewportSize(tv ? { width: 1920, height: 1080 } : { width: 1440, height: 950 });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    if (tv) await page.getByRole('switch', { name: '电视模式', exact: true }).click();
    assert.equal(await page.getByRole('slider', { name: '默认音量', exact: true }).count(), 0);
    for (const columns of [2, 3, 4, 5, 6]) {
      await page.getByRole('combobox', { name: '卡片大小', exact: true }).selectOption(String(columns));
      assert.equal(await page.locator('main .media-grid').evaluate(grid =>
        getComputedStyle(grid).gridTemplateColumns.split(' ').length), columns);
      assert.equal(await page.evaluate(() => window.reliability.boot.preferences.cardColumns), columns);
      await close();
      await firstCard().focus();
      await pressPad(page, 15);
      assert.equal(await focused(page.locator('main .media-card').nth(1)), true);
      await firstCard().focus();
      await pressPad(page, 13);
      assert.equal(await focused(page.locator('main .media-card').nth(columns)), true);
      await page.getByRole('button', { name: '设置', exact: true }).click();
    }
    await page.getByRole('combobox', { name: '卡片大小', exact: true }).selectOption('0');
    await close();
    assert.equal(await page.locator('main .media-grid').evaluate(grid =>
      getComputedStyle(grid).gridTemplateColumns.split(' ').length), tv ? 3 : 4);
    await firstCard().focus();
    await pressPad(page, 15);
    await page.screenshot({ path: resolve(output, tv ? 'cards-tv.png' : 'cards-desktop.png') });
  }
  checks.push('2–6 cards per row persist with exact row/column navigation on desktop and TV, and automatic layout restores');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('combobox', { name: '卡片大小', exact: true }).selectOption('4');
  await page.evaluate(() => { window.reliability.failNextPreferences = true; });
  await page.getByRole('combobox', { name: '卡片大小', exact: true }).selectOption('5');
  await page.waitForFunction(() => document.querySelector('[aria-label="卡片大小"]').value === '4');
  assert.equal(await page.locator('main .media-grid').evaluate(grid =>
    getComputedStyle(grid).gridTemplateColumns.split(' ').length), 4);
  assert.equal(await page.evaluate(() => window.reliability.boot.preferences.cardColumns), 4);
  await close();
  checks.push('failed card layout saves restore both the select and the committed grid');

  await firstCard().focus();
  await pressPad(page, 0);
  await page.waitForFunction(() => !!document.querySelector('video') && !document.querySelector('video').paused);
  assert.equal(await page.getByRole('slider', { name: '音量', exact: true }).count(), 0);
  assert.equal(await page.locator('video').evaluate(video => video.volume), 1);
  await page.evaluate(() => { window.reliability.holdBootstrap = true; });
  const releases = await page.evaluate(() => window.reliability.releases.length);
  await pressPad(page, 1);
  await page.waitForFunction(() => document.querySelector('.player:not(.controls-visible)'));
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  assert.equal(await page.evaluate(() => window.reliability.releases.length), releases);
  await pressPad(page, 1);
  await page.waitForFunction(() => !!window.reliability.finishBootstrap);
  await page.waitForFunction(() => document.activeElement?.matches('main .media-card'));
  assert.equal(await focused(firstCard()), true);
  await nav('本地片库').focus();
  await page.evaluate(() => { window.reliability.holdBootstrap = false; window.reliability.finishBootstrap(); });
  await page.waitForTimeout(200);
  assert.equal(await focused(nav('本地片库')), true);
  checks.push('B hides before exiting; return focus restores during a slow refresh without stealing movement; volume stays system-controlled');

  await pressPad(page, 3);
  await page.getByRole('dialog').waitFor();
  await page.getByRole('textbox', { name: '搜索关键词', exact: true }).fill('直播');
  await page.getByRole('dialog').getByRole('button', { name: '搜索', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.matches('main .media-card'));
  assert.equal(await focused(firstCard()), true);
  const liveFilter = page.getByRole('button', { name: '直播', exact: true });
  await liveFilter.focus();
  await pressPad(page, 0);
  await firstCard().waitFor();
  assert.equal(await firstCard().getAttribute('data-media-id'), 'live:42');
  assert.equal(await firstCard().locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await focused(liveFilter), true);
  checks.push('search submission lands on results; switching to live keeps filter focus and displays artwork');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify(checks, null, 2));
  console.log(JSON.stringify({ checks, output }, null, 2));
} finally {
  await session.close();
}
