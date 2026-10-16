import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-layout-navigation');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const focused = locator => locator.evaluate(node => node === document.activeElement);
  const settings = () => page.getByRole('button', { name: '设置', exact: true }).click();
  const closeModal = () => page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  const cards = () => page.locator('main .media-grid').first().locator('.media-card');
  try {
    await page.evaluate(() => {
      const state = window.reliability;
      state.boot.preferences.tvMode = document.documentElement.clientWidth === 1920;
      state.boot.library = Array.from({ length: 13 }, (_, index) => ({
        ...state.boot.queue[0], id: `video:${index}`, title: `导航测试视频 ${index + 1}`,
      }));
      window.hub.browse = async request => {
        state.browse.push(structuredClone(request));
        return { items: structuredClone(state.boot.library), hasMore: false };
      };
    });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await cards().first().waitFor();
    await connectPad(page);

    const navLayout = await page.locator('.navigation-bar').evaluate(bar => ({
      nav: bar.getBoundingClientRect().toJSON(),
      main: document.querySelector('main').getBoundingClientRect().toJSON(),
      buttons: [...bar.querySelectorAll('button')].map(node => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const padding = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { rect: rect.toJSON(), padding, hit: node === hit || node.contains(hit) };
      }),
    }));
    assert.ok(navLayout.nav.bottom <= navLayout.main.top);
    for (const { rect, padding, hit } of navLayout.buttons) {
      assert.ok(rect.left - padding >= 0 && rect.right + padding <= page.viewportSize().width);
      assert.equal(hit, true);
      assert.ok(Math.abs(rect.top - navLayout.buttons[0].rect.top) < 1);
    }
    assert.equal(navLayout.main.left, 0, 'content uses the full width below the top navigation');
    await page.getByRole('button', { name: '首页', exact: true }).focus();
    await pressPad(page, 15);
    assert.equal(await focused(page.getByRole('button', { name: '哔哩哔哩', exact: true })), true);
    await pressPad(page, 0);
    await cards().first().waitFor();
    await pressPad(page, 13);
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('main')), true);
    checks.push(`${mode}: horizontal top navigation, confirm/down entry and full-width content are visible and hittable`);

    for (const columns of [2, 3, 4, 5, 6]) {
      await settings();
      await page.getByRole('combobox', { name: '卡片大小', exact: true }).selectOption(String(columns));
      await closeModal();
      await cards().nth(columns - 1).focus();
      await pressPad(page, 15);
      assert.equal(await focused(cards().nth(columns)), true, 'right edge moves to next row first card');
      await pressPad(page, 14);
      assert.equal(await focused(cards().nth(columns - 1)), true, 'left edge moves to previous row last card');
      await cards().first().focus();
      await pressPad(page, 14);
      assert.equal(await focused(cards().first()), true, 'first card stays at the start of its grid');
      await cards().last().focus();
      await pressPad(page, 15);
      assert.equal(await focused(cards().last()), true, 'last partial row does not wrap to another list');
      await cards().nth(columns).focus();
      await page.keyboard.press('ArrowLeft');
      assert.equal(await focused(cards().nth(columns - 1)), true);
      await page.keyboard.press('ArrowRight');
      assert.equal(await focused(cards().nth(columns)), true);
    }
    checks.push(`${mode}: 2–6 columns wrap horizontally in source order, including partial rows and keyboard input`);

    for (const label of ['首页', '哔哩哔哩', '关注直播', '番剧与影视', '本地片库', '我的收藏']) {
      const nav = page.getByRole('button', { name: label, exact: true });
      await nav.click();
      await cards().first().waitFor();
      await cards().first().focus();
      const levels = await page.locator('main [data-browse-nav]').count();
      for (let level = 0; level <= levels; level++) await pressPad(page, 1);
      assert.equal(await focused(nav), true);
      assert.equal(await page.locator('main').getAttribute('aria-label'), label);
      await pressPad(page, 1);
      assert.equal(await focused(nav), true);
    }
    await page.getByRole('textbox', { name: '搜索视频', exact: true }).fill('导航');
    await page.getByRole('textbox', { name: '搜索视频', exact: true }).press('Enter');
    await page.waitForFunction(() => document.activeElement?.matches('main .media-card'));
    await pressPad(page, 1);
    assert.equal(await focused(page.getByRole('button', { name: '全部', exact: true })), true);
    await pressPad(page, 1);
    assert.equal(await focused(page.getByRole('button', { name: '首页', exact: true })), true);
    assert.equal(await page.locator('main').getAttribute('aria-label'), '搜索：导航');
    checks.push(`${mode}: B returns content through each navigation level without replacing the page`);

    await settings();
    const enabled = page.getByRole('switch', { name: '显示 B 站视频弹幕', exact: true });
    const opacity = page.getByRole('slider', { name: '弹幕不透明度', exact: true });
    const font = page.getByRole('combobox', { name: '弹幕字号', exact: true });
    assert.equal(await opacity.isDisabled(), true);
    await enabled.focus();
    await pressPad(page, 0);
    await pressPad(page, 13);
    assert.equal(await focused(opacity), true);
    await pressPad(page, 14);
    assert.equal(Number(await opacity.inputValue()), .75);
    await page.waitForFunction(() => window.reliability.boot.preferences.danmakuOpacity === .75);
    await pressPad(page, 15);
    assert.equal(Number(await opacity.inputValue()), .8);
    await pressPad(page, 13);
    assert.equal(await focused(font), true);
    await pressPad(page, 12);
    assert.equal(await focused(opacity), true);
    await pressPad(page, 12);
    assert.equal(await focused(enabled), true);
    await pressPad(page, 0);
    await pressPad(page, 13);
    assert.equal(await focused(page.getByRole('slider', { name: '摇杆死区', exact: true })), true);
    await enabled.focus();
    await pressPad(page, 0);
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(opacity), true);
    await page.screenshot({ path: resolve(output, `${mode}-settings.png`) });
    await pressPad(page, 1);
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    checks.push(`${mode}: setting rows reach opacity from both directions, persist adjustments and skip disabled controls`);

    await page.getByRole('button', { name: '哔哩哔哩', exact: true }).click();
    await cards().first().focus();
    await pressPad(page, 1);
    await page.locator('main').evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: resolve(output, `${mode}-navigation.png`) });
    await cards().first().click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    const row = page.locator('.player-buttons');
    const next = page.locator('[data-player-action="next"]');
    const rate = page.locator('[data-player-choice="rate"]');
    await next.focus();
    await pressPad(page, 15);
    assert.equal(await focused(rate), true);
    await pressPad(page, 14);
    assert.equal(await focused(next), true);
    await rate.focus();
    await pressPad(page, 12);
    assert.equal(await focused(page.locator('.timeline')), true);
    await rate.focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await focused(next), true);
    await page.keyboard.press('ArrowRight');
    assert.equal(await focused(rate), true);
    await row.locator('button').first().focus();
    await pressPad(page, 14);
    assert.equal(await focused(row.locator('button').first()), true);
    await row.locator('button').last().focus();
    await pressPad(page, 15);
    assert.equal(await focused(row.locator('button').last()), true);
    const count = await row.locator('button').count();
    for (let index = 0; index < count; index++) {
      await row.locator('button').nth(index).focus();
      await pressPad(page, 12);
      assert.equal(await focused(page.locator('.timeline')), true);
    }
    await rate.focus();
    await pressPad(page, 0);
    await page.locator('.player-option-panel').waitFor();
    await pressPad(page, 1);
    await page.waitForFunction(() => document.activeElement?.matches('[data-player-choice="rate"]'));
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 0);
    await page.screenshot({ path: resolve(output, `${mode}-player.png`) });
    await pressPad(page, 1);
    await pressPad(page, 1);
    await page.locator('.player').waitFor({ state: 'detached' });
    checks.push(`${mode}: left/right stays in the player button row across its gap; up reaches timeline; option B restores its opener`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, simulatedGamepad: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
